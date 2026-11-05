import {
	Color,
	DataTexture,
	DataUtils,
	FloatType,
	HalfFloatType,
	LinearSRGBColorSpace,
	NoColorSpace,
	RGBAFormat,
	RGBFormat,
	SRGBColorSpace,
	UnsignedByteType,
	Vector3
} from 'three';

const _color = /*@__PURE__*/ new Color();
const _rgb = { r: 0, g: 0, b: 0 };

// images are read in tiles, because browsers limit the canvas area (Safari: 4096 * 4096 pixels)

const _TILE_SIZE = 4096;

/**
 * One part of an extracted light, see {@link EnvironmentLightExtractor~ExtractedLight}.
 *
 * @typedef {Object} EnvironmentLightExtractor~LightPart
 * @property {Vector3} direction - Unit vector from the scene towards the part, in the space of the environment map.
 * @property {Color} color - The color, normalized so its largest component is `1`.
 * @property {number} intensity - The irradiance, usable as `DirectionalLight.intensity`.
 * @property {number} coneAngle - Half-angle (in radians) of the cone the part emits from.
 */

/**
 * Describes a light source that was found in an environment map.
 *
 * @typedef {Object} EnvironmentLightExtractor~ExtractedLight
 * @property {Vector3} direction - Unit vector from the scene towards the light, in the space of the environment map.
 * @property {Color} color - The color, normalized so its largest component is `1`.
 * @property {number} intensity - The irradiance, usable as `DirectionalLight.intensity`.
 * @property {number} coneAngle - Half-angle (in radians) of the cone the light emits from.
 * @property {number} energyFraction - Fraction of the total environment energy emitted by this light.
 * @property {Array<Array<EnvironmentLightExtractor~LightPart>>} partitions - `partitions[ n - 1 ]` divides
 * the light into `n` parts, for soft shadows from large or irregular light sources. Each partition splits
 * the widest part of the previous one into two halves of equal energy (median cut). The energies of the
 * parts add up to the energy of the light. `partitions[ 0 ]` holds the light as one part.
 */

/**
 * The result of {@link EnvironmentLightExtractor.extract}.
 *
 * @typedef {Object} EnvironmentLightExtractor~Result
 * @property {Array<EnvironmentLightExtractor~ExtractedLight>} lights - The extracted lights, strongest first.
 * @property {number} directionality - `0` if the environment emits equally in all directions,
 * `1` if all light comes from one direction.
 * @property {number} dominance - Fraction of the total environment energy emitted by the extracted lights.
 * @property {number} threshold - The radiance (luminance) above which texels are part of a light.
 * @property {?DataTexture} texture - A copy of the environment map without the extracted lights, or `null`.
 */

/**
 * Finds the dominant light sources (sun, lamps, windows) of an equirectangular environment map,
 * so they can cast shadows with {@link EnvironmentShadowLights}.
 *
 * Texels brighter than `threshold` times the mean radiance are grouped into connected regions.
 * The strongest regions become lights with a direction, color, intensity and cone angle. The light
 * energy is removed from a copy of the environment map, so the scene is not lit twice.
 *
 * ```js
 * const hdr = await new HDRLoader().loadAsync( 'sunset.hdr' );
 * hdr.mapping = THREE.EquirectangularReflectionMapping;
 *
 * const result = await EnvironmentLightExtractor.extract( hdr );
 *
 * scene.background = hdr;
 * scene.environment = result.texture; // the environment without the extracted lights
 * scene.add( new EnvironmentShadowLights( result.lights ) );
 * ```
 *
 * The analysis runs in a Web Worker, if available. It needs the texel data on the CPU: a
 * `DataTexture` (e.g. from `HDRLoader` or `EXRLoader`) or a texture with an image, canvas or image
 * bitmap. Light intensities of 8-bit textures are too low if bright texels are clipped, so use
 * HDR environment maps where possible.
 *
 * @hideconstructor
 * @three_import import { EnvironmentLightExtractor } from 'three/addons/lights/EnvironmentLightExtractor.js';
 */
class EnvironmentLightExtractor {

	/**
	 * Finds the dominant light sources of the given equirectangular environment map.
	 *
	 * @async
	 * @param {Texture} texture - The equirectangular environment map.
	 * @param {Object} [options] - The options.
	 * @param {number} [options.maxLights=2] - The maximum number of lights.
	 * @param {number} [options.threshold=8] - Texels brighter than this factor times the mean radiance are part of a light.
	 * @param {number} [options.minEnergy=0.05] - The minimum fraction of the total energy a light must emit.
	 * @param {number} [options.minElevation=-Math.PI/2] - The minimum elevation (in radians) of a light, in the space
	 * of the environment map. Bright areas below it stay in the environment map. Set it to `0` to keep sunlit ground
	 * or snow in the environment map. Studio lights are often slightly below the horizon.
	 * @param {number} [options.samples=4] - The maximum number of parts per light, see `ExtractedLight.partitions`.
	 * @param {number} [options.resolution=512] - The width of the grid used to group bright texels into regions.
	 * @param {boolean} [options.removeLights=true] - Whether to create a copy of the environment map without the lights.
	 * @return {Promise<EnvironmentLightExtractor~Result>} A Promise that resolves with the extraction result.
	 */
	static async extract( texture, options = {} ) {

		const {
			maxLights = 2,
			threshold = 8,
			minEnergy = 0.05,
			minElevation = - Math.PI / 2,
			samples = 4,
			resolution = 512,
			removeLights = true
		} = options;

		const source = readSource( texture );

		const output = await runAnalysis( {
			data: source.data,
			width: source.width,
			height: source.height,
			channels: source.channels,
			encoding: source.encoding,
			decode: source.decode,
			flipY: texture.flipY,
			maxLights,
			thresholdFactor: threshold,
			minEnergy,
			minElevation,
			maxParts: samples,
			resolution
		} );

		if ( output.clipped ) {

			console.warn( 'THREE.EnvironmentLightExtractor: Light texels are clipped in the 8-bit texture. Light intensities are too low.' );

		}

		const toPart = ( part ) => ( {
			direction: new Vector3().fromArray( part.direction ),
			color: new Color().fromArray( part.color ),
			intensity: part.intensity,
			coneAngle: part.coneAngle
		} );

		const lights = output.lights.map( ( light ) => {

			const partitions = light.partitions.map( ( parts ) => parts.map( toPart ) );

			return { ...toPart( light ), energyFraction: light.energyFraction, partitions };

		} );

		let residual = null;

		if ( removeLights ) {

			residual = source.createTexture( output.data );

			removeSelectedLights( source, residual.image.data, output );

		}

		return {
			lights,
			directionality: output.directionality,
			dominance: output.dominance,
			threshold: output.threshold,
			texture: residual
		};

	}

}

// runs the analysis in a worker, which takes ownership of input.data and returns it

function runAnalysis( input ) {

	if ( typeof Worker === 'undefined' ) return Promise.resolve( analyze( input ) );

	const body = `const analyze = ${ analyze.toString() };

	self.onmessage = ( event ) => {

		const output = analyze( event.data );

		self.postMessage( output, [ output.data.buffer, output.cellSelected.buffer ] );

	};`;

	const url = URL.createObjectURL( new Blob( [ body ], { type: 'application/javascript' } ) );

	return new Promise( ( resolve, reject ) => {

		const worker = new Worker( url );

		const finish = () => {

			worker.terminate();
			URL.revokeObjectURL( url );

		};

		worker.onmessage = ( event ) => {

			finish();
			resolve( event.data );

		};

		worker.onerror = ( event ) => {

			finish();
			reject( new Error( 'THREE.EnvironmentLightExtractor: ' + event.message ) );

		};

		worker.postMessage( input, [ input.data.buffer ] );

	} );

}

// the analysis, self-contained so it can run in a worker

function analyze( input ) {

	const { data, width, height, channels, flipY, maxLights, thresholdFactor, minEnergy, minElevation, maxParts, resolution } = input;

	// the lookup table that decodes a channel value, null for float data

	let table = input.decode;

	if ( input.encoding === 'half' ) {

		table = new Float32Array( 65536 );

		for ( let h = 0; h < 65536; h ++ ) {

			const exponent = ( h >> 10 ) & 0x1f;
			const mantissa = h & 0x3ff;

			let value;

			if ( exponent === 0 ) value = mantissa * Math.pow( 2, - 24 );
			else if ( exponent === 31 ) value = mantissa === 0 ? Infinity : NaN;
			else value = ( 1 + mantissa / 1024 ) * Math.pow( 2, exponent - 15 );

			table[ h ] = ( h & 0x8000 ) !== 0 ? - value : value;

		}

	}

	const isByte = input.encoding === 'byte';

	const rgb = [ 0, 0, 0 ];

	// returns the luminance of the texel and writes its color to rgb

	function read( x, y ) {

		const i = ( y * width + x ) * channels;

		if ( table === null ) {

			rgb[ 0 ] = data[ i ];
			rgb[ 1 ] = data[ i + 1 ];
			rgb[ 2 ] = data[ i + 2 ];

		} else {

			rgb[ 0 ] = table[ data[ i ] ];
			rgb[ 1 ] = table[ data[ i + 1 ] ];
			rgb[ 2 ] = table[ data[ i + 2 ] ];

		}

		return 0.2126 * rgb[ 0 ] + 0.7152 * rgb[ 1 ] + 0.0722 * rgb[ 2 ];

	}

	// direction and solid angle of each texel, see equirectUv() in common.glsl

	const sinPhi = new Float64Array( width );
	const cosPhi = new Float64Array( width );

	for ( let x = 0; x < width; x ++ ) {

		const phi = ( ( x + 0.5 ) / width - 0.5 ) * 2 * Math.PI;

		sinPhi[ x ] = Math.sin( phi );
		cosPhi[ x ] = Math.cos( phi );

	}

	const sinLat = new Float64Array( height );
	const cosLat = new Float64Array( height );
	const rowSolidAngle = new Float64Array( height );

	for ( let y = 0; y < height; y ++ ) {

		// row 0 is at the top of the texture (v = 1) when flipY is enabled

		const v0 = flipY ? 1 - y / height : y / height;
		const v1 = flipY ? 1 - ( y + 1 ) / height : ( y + 1 ) / height;

		const lat = ( ( v0 + v1 ) / 2 - 0.5 ) * Math.PI;

		sinLat[ y ] = Math.sin( lat );
		cosLat[ y ] = Math.cos( lat );
		rowSolidAngle[ y ] = ( 2 * Math.PI / width ) * Math.abs( Math.sin( ( v1 - 0.5 ) * Math.PI ) - Math.sin( ( v0 - 0.5 ) * Math.PI ) );

	}

	// the grid used to group bright texels into regions

	const gridWidth = Math.max( 1, Math.min( width, resolution ) );
	const gridHeight = Math.max( 1, Math.round( gridWidth * height / width ) );
	const gridSize = gridWidth * gridHeight;

	const gridColumn = new Int32Array( width );
	const gridRow = new Int32Array( height );

	for ( let x = 0; x < width; x ++ ) gridColumn[ x ] = Math.floor( x * gridWidth / width );
	for ( let y = 0; y < height; y ++ ) gridRow[ y ] = Math.floor( y * gridHeight / height );

	const output = {
		data,
		directionality: 0,
		dominance: 0,
		threshold: 0,
		gridWidth,
		gridHeight,
		cellSelected: new Uint8Array( gridSize ),
		lights: [],
		clipped: false
	};

	// pass 1: total energy, mean direction and the brightest texel of each grid cell

	const cellMax = new Float32Array( gridSize );

	let totalEnergy = 0;
	let sumX = 0, sumY = 0, sumZ = 0;

	for ( let y = 0; y < height; y ++ ) {

		const solidAngle = rowSolidAngle[ y ];
		const cellRow = gridRow[ y ] * gridWidth;

		for ( let x = 0; x < width; x ++ ) {

			const lum = read( x, y );

			// skips black, negative, NaN and infinite texels

			if ( ! ( lum > 0 && lum < Infinity ) ) continue;

			const energy = lum * solidAngle;

			totalEnergy += energy;
			sumX += energy * cosLat[ y ] * cosPhi[ x ];
			sumY += energy * sinLat[ y ];
			sumZ += energy * cosLat[ y ] * sinPhi[ x ];

			const cell = cellRow + gridColumn[ x ];

			if ( lum > cellMax[ cell ] ) cellMax[ cell ] = lum;

		}

	}

	if ( totalEnergy === 0 ) return output;

	output.directionality = Math.hypot( sumX, sumY, sumZ ) / totalEnergy;

	const threshold = thresholdFactor * totalEnergy / ( 4 * Math.PI );
	output.threshold = threshold;

	// group the bright grid cells into connected regions, wrapping in longitude and across the poles

	const labels = new Int32Array( gridSize ).fill( - 1 );
	const regions = [];
	const stack = [];
	const halfWidth = Math.floor( gridWidth / 2 );

	for ( let start = 0; start < gridSize; start ++ ) {

		if ( labels[ start ] >= 0 || cellMax[ start ] <= threshold ) continue;

		const region = [];

		labels[ start ] = regions.length;
		stack.push( start );

		while ( stack.length > 0 ) {

			const cell = stack.pop();
			const cx = cell % gridWidth;
			const cy = ( cell - cx ) / gridWidth;

			region.push( cell );

			for ( let dy = - 1; dy <= 1; dy ++ ) {

				for ( let dx = - 1; dx <= 1; dx ++ ) {

					if ( dx === 0 && dy === 0 ) continue;

					let nx = cx + dx;
					let ny = cy + dy;

					if ( ny < 0 || ny >= gridHeight ) {

						// the neighbor across a pole is half a turn away

						ny = ny < 0 ? 0 : gridHeight - 1;
						nx += halfWidth;

					}

					nx = ( ( nx % gridWidth ) + gridWidth ) % gridWidth;

					const neighbor = ny * gridWidth + nx;

					if ( labels[ neighbor ] >= 0 || cellMax[ neighbor ] <= threshold ) continue;

					labels[ neighbor ] = regions.length;
					stack.push( neighbor );

				}

			}

		}

		regions.push( region );

	}

	// pass 2: the energy above the threshold of each region cell

	const STRIDE = 7; // energy r, g, b, luminance energy, energy-weighted direction x, y, z

	const cellIndex = new Int32Array( gridSize ).fill( - 1 );

	let cellCount = 0;

	for ( const region of regions ) {

		for ( const cell of region ) cellIndex[ cell ] = cellCount ++;

	}

	const cellStats = new Float64Array( cellCount * STRIDE );
	const cellClipped = new Uint8Array( cellCount );

	for ( let y = 0; y < height; y ++ ) {

		const solidAngle = rowSolidAngle[ y ];
		const cellRow = gridRow[ y ] * gridWidth;

		for ( let x = 0; x < width; x ++ ) {

			const index = cellIndex[ cellRow + gridColumn[ x ] ];

			if ( index < 0 ) continue;

			const lum = read( x, y );

			if ( ! ( lum > threshold && lum < Infinity ) ) continue;

			// the radiance above the threshold, with the chroma of the texel

			const removed = 1 - threshold / lum;
			const energy = lum * removed * solidAngle;

			const s = index * STRIDE;

			cellStats[ s ] += rgb[ 0 ] * removed * solidAngle;
			cellStats[ s + 1 ] += rgb[ 1 ] * removed * solidAngle;
			cellStats[ s + 2 ] += rgb[ 2 ] * removed * solidAngle;
			cellStats[ s + 3 ] += energy;
			cellStats[ s + 4 ] += energy * cosLat[ y ] * cosPhi[ x ];
			cellStats[ s + 5 ] += energy * sinLat[ y ];
			cellStats[ s + 6 ] += energy * cosLat[ y ] * sinPhi[ x ];

			if ( isByte ) {

				const i = ( y * width + x ) * channels;

				if ( data[ i ] === 255 || data[ i + 1 ] === 255 || data[ i + 2 ] === 255 ) cellClipped[ index ] = 1;

			}

		}

	}

	function sum( cells ) {

		const total = { r: 0, g: 0, b: 0, energy: 0, x: 0, y: 0, z: 0 };

		for ( const cell of cells ) {

			const s = cellIndex[ cell ] * STRIDE;

			total.r += cellStats[ s ];
			total.g += cellStats[ s + 1 ];
			total.b += cellStats[ s + 2 ];
			total.energy += cellStats[ s + 3 ];
			total.x += cellStats[ s + 4 ];
			total.y += cellStats[ s + 5 ];
			total.z += cellStats[ s + 6 ];

		}

		return total;

	}

	// the irradiance of a small source is radiance times solid angle

	function describe( cells, fallbackDirection ) {

		const { r, g, b, energy, x, y, z } = sum( cells );

		const length = Math.hypot( x, y, z );
		const intensity = Math.max( r, g, b );

		// the mean cosine of a uniform spherical cap with half-angle a is ( 1 + cos( a ) ) / 2

		const meanCosine = length / energy;

		return {
			direction: length > 0 ? [ x / length, y / length, z / length ] : fallbackDirection,
			color: [ r / intensity, g / intensity, b / intensity ],
			intensity,
			coneAngle: Math.acos( Math.min( 1, Math.max( - 1, 2 * meanCosine - 1 ) ) )
		};

	}

	// splits the cells into two halves of equal energy, along the axis of the largest angular spread

	function split( cells ) {

		const { x, y, z } = sum( cells );
		const length = Math.hypot( x, y, z );
		const d = [ x / length, y / length, z / length ];

		// tangent t = normalize( reference x d ), bitangent b = d x t

		const ref = Math.abs( d[ 1 ] ) < 0.99 ? [ 0, 1, 0 ] : [ 1, 0, 0 ];

		const t = [ ref[ 1 ] * d[ 2 ] - ref[ 2 ] * d[ 1 ], ref[ 2 ] * d[ 0 ] - ref[ 0 ] * d[ 2 ], ref[ 0 ] * d[ 1 ] - ref[ 1 ] * d[ 0 ] ];
		const tLength = Math.hypot( t[ 0 ], t[ 1 ], t[ 2 ] );
		t[ 0 ] /= tLength; t[ 1 ] /= tLength; t[ 2 ] /= tLength;

		const b = [ d[ 1 ] * t[ 2 ] - d[ 2 ] * t[ 1 ], d[ 2 ] * t[ 0 ] - d[ 0 ] * t[ 2 ], d[ 0 ] * t[ 1 ] - d[ 1 ] * t[ 0 ] ];

		// energy-weighted covariance of the cell directions in the tangent plane

		const points = [];

		let weight = 0, mx = 0, my = 0;

		for ( const cell of cells ) {

			const s = cellIndex[ cell ] * STRIDE;
			const e = cellStats[ s + 3 ];
			const cellLength = Math.hypot( cellStats[ s + 4 ], cellStats[ s + 5 ], cellStats[ s + 6 ] );

			const ux = cellStats[ s + 4 ] / cellLength, uy = cellStats[ s + 5 ] / cellLength, uz = cellStats[ s + 6 ] / cellLength;

			const px = ux * t[ 0 ] + uy * t[ 1 ] + uz * t[ 2 ];
			const py = ux * b[ 0 ] + uy * b[ 1 ] + uz * b[ 2 ];

			points.push( { cell, e, px, py } );

			weight += e;
			mx += e * px;
			my += e * py;

		}

		mx /= weight;
		my /= weight;

		let cxx = 0, cyy = 0, cxy = 0;

		for ( const p of points ) {

			const dx = p.px - mx, dy = p.py - my;

			cxx += p.e * dx * dx;
			cyy += p.e * dy * dy;
			cxy += p.e * dx * dy;

		}

		// the principal axis of the covariance

		const angle = 0.5 * Math.atan2( 2 * cxy, cxx - cyy );
		const ax = Math.cos( angle ), ay = Math.sin( angle );

		for ( const p of points ) p.projection = p.px * ax + p.py * ay;

		points.sort( ( p, q ) => p.projection - q.projection );

		let index = 0, accumulated = 0;

		while ( index < points.length - 1 && accumulated + points[ index ].e <= weight / 2 ) accumulated += points[ index ++ ].e;

		index = Math.min( points.length - 1, Math.max( 1, index ) );

		return [ points.slice( 0, index ).map( ( p ) => p.cell ), points.slice( index ).map( ( p ) => p.cell ) ];

	}

	// median cut: each partition splits the part of the previous one with the largest angular spread

	function partition( cells, direction ) {

		const partitions = [[ cells ]];

		while ( partitions.length < maxParts ) {

			const previous = partitions[ partitions.length - 1 ];

			let best = - 1, bestSpread = 0;

			for ( let j = 0; j < previous.length; j ++ ) {

				if ( previous[ j ].length < 2 ) continue;

				// energy times ( 1 - mean cosine )

				const { energy, x, y, z } = sum( previous[ j ] );
				const spread = energy - Math.hypot( x, y, z );

				if ( spread > bestSpread ) {

					best = j;
					bestSpread = spread;

				}

			}

			if ( best < 0 ) break;

			const next = previous.slice();
			next.splice( best, 1, ...split( previous[ best ] ) );

			partitions.push( next );

		}

		return partitions.map( ( parts ) => parts.map( ( part ) => describe( part, direction ) ) );

	}

	// keep the strongest regions above the minimum elevation

	const regionEnergy = regions.map( ( region ) => sum( region ).energy );
	const order = regions.map( ( region, index ) => index ).sort( ( a, b ) => regionEnergy[ b ] - regionEnergy[ a ] );

	const minHeight = Math.sin( minElevation );

	for ( const index of order ) {

		if ( output.lights.length >= maxLights ) break;

		const energyFraction = regionEnergy[ index ] / totalEnergy;

		if ( energyFraction < minEnergy ) break;

		const region = regions[ index ];
		const light = describe( region, [ 0, 1, 0 ] );

		if ( light.direction[ 1 ] < minHeight ) continue;

		light.energyFraction = energyFraction;
		light.partitions = partition( region, light.direction );

		output.lights.push( light );
		output.dominance += energyFraction;

		for ( const cell of region ) {

			output.cellSelected[ cell ] = 1;

			if ( cellClipped[ cellIndex[ cell ] ] === 1 ) output.clipped = true;

		}

	}

	return output;

}

// clamps the texels of the extracted lights to the threshold

function removeSelectedLights( source, data, output ) {

	const { width, height } = source;
	const { gridWidth, gridHeight, cellSelected, threshold } = output;

	const read = source.reader( data );
	const write = source.writer( data );

	for ( let cy = 0; cy < gridHeight; cy ++ ) {

		// the texel rows and columns of a cell, the inverse of the grid mapping in analyze()

		const y0 = Math.ceil( cy * height / gridHeight );
		const y1 = Math.ceil( ( cy + 1 ) * height / gridHeight );

		for ( let cx = 0; cx < gridWidth; cx ++ ) {

			if ( cellSelected[ cy * gridWidth + cx ] === 0 ) continue;

			const x0 = Math.ceil( cx * width / gridWidth );
			const x1 = Math.ceil( ( cx + 1 ) * width / gridWidth );

			for ( let y = y0; y < y1; y ++ ) {

				for ( let x = x0; x < x1; x ++ ) {

					read( x, y, _rgb );

					const lum = 0.2126 * _rgb.r + 0.7152 * _rgb.g + 0.0722 * _rgb.b;

					if ( ! ( lum > threshold && lum < Infinity ) ) continue;

					const scale = threshold / lum;

					write( x, y, _rgb.r * scale, _rgb.g * scale, _rgb.b * scale );

				}

			}

		}

	}

}

// copies the texel data of the texture and creates a reader and writer for it, in linear working color space

function readSource( texture ) {

	const image = texture.image;

	if ( texture.isCubeTexture || texture.isCompressedTexture || texture.isRenderTargetTexture || texture.isData3DTexture || texture.isDataArrayTexture ) {

		throw new Error( 'THREE.EnvironmentLightExtractor: Only equirectangular data or image textures are supported.' );

	}

	if ( image === null || image === undefined ) {

		throw new Error( 'THREE.EnvironmentLightExtractor: The texture has no image data.' );

	}

	let data, width, height, channels, type, format;

	if ( image.data !== undefined ) {

		width = image.width;
		height = image.height;
		data = image.data.slice();
		type = texture.type;
		format = texture.format;

		if ( format === RGBAFormat ) channels = 4;
		else if ( format === RGBFormat ) channels = 3;
		else throw new Error( 'THREE.EnvironmentLightExtractor: Only RGB and RGBA textures are supported.' );

		if ( type !== FloatType && type !== HalfFloatType && type !== UnsignedByteType ) {

			throw new Error( 'THREE.EnvironmentLightExtractor: Only float, half float and unsigned byte textures are supported.' );

		}

	} else {

		width = image.width;
		height = image.height;
		data = readImage( image, width, height );
		channels = 4;
		type = UnsignedByteType;
		format = RGBAFormat;

	}

	let colorSpace = texture.colorSpace;

	if ( colorSpace !== SRGBColorSpace && colorSpace !== LinearSRGBColorSpace && colorSpace !== NoColorSpace ) {

		console.warn( 'THREE.EnvironmentLightExtractor: Unsupported color space. Texels are read as linear.' );
		colorSpace = LinearSRGBColorSpace;

	}

	const isSRGB = colorSpace === SRGBColorSpace;

	let decode = null;

	if ( type === UnsignedByteType ) {

		decode = new Float32Array( 256 );

		for ( let i = 0; i < 256; i ++ ) {

			decode[ i ] = isSRGB ? _color.setRGB( i / 255, 0, 0, SRGBColorSpace ).r : i / 255;

		}

	}

	function reader( target ) {

		if ( type === FloatType ) {

			return ( x, y, color ) => {

				const i = ( y * width + x ) * channels;

				color.r = target[ i ];
				color.g = target[ i + 1 ];
				color.b = target[ i + 2 ];

			};

		} else if ( type === HalfFloatType ) {

			return ( x, y, color ) => {

				const i = ( y * width + x ) * channels;

				color.r = DataUtils.fromHalfFloat( target[ i ] );
				color.g = DataUtils.fromHalfFloat( target[ i + 1 ] );
				color.b = DataUtils.fromHalfFloat( target[ i + 2 ] );

			};

		}

		return ( x, y, color ) => {

			const i = ( y * width + x ) * channels;

			color.r = decode[ target[ i ] ];
			color.g = decode[ target[ i + 1 ] ];
			color.b = decode[ target[ i + 2 ] ];

		};

	}

	function writer( target ) {

		if ( type === FloatType ) {

			return ( x, y, r, g, b ) => {

				const i = ( y * width + x ) * channels;

				target[ i ] = r;
				target[ i + 1 ] = g;
				target[ i + 2 ] = b;

			};

		} else if ( type === HalfFloatType ) {

			return ( x, y, r, g, b ) => {

				const i = ( y * width + x ) * channels;

				target[ i ] = DataUtils.toHalfFloat( r );
				target[ i + 1 ] = DataUtils.toHalfFloat( g );
				target[ i + 2 ] = DataUtils.toHalfFloat( b );

			};

		}

		return ( x, y, r, g, b ) => {

			const i = ( y * width + x ) * channels;

			if ( isSRGB ) {

				_color.setRGB( r, g, b ).getRGB( _rgb, SRGBColorSpace );

				r = _rgb.r;
				g = _rgb.g;
				b = _rgb.b;

			}

			target[ i ] = Math.round( Math.min( 1, r ) * 255 );
			target[ i + 1 ] = Math.round( Math.min( 1, g ) * 255 );
			target[ i + 2 ] = Math.round( Math.min( 1, b ) * 255 );

		};

	}

	function createTexture( target ) {

		const output = new DataTexture( target, width, height, format, type );

		output.mapping = texture.mapping;
		output.wrapS = texture.wrapS;
		output.wrapT = texture.wrapT;
		output.magFilter = texture.magFilter;
		output.minFilter = texture.minFilter;
		output.anisotropy = texture.anisotropy;
		output.generateMipmaps = texture.generateMipmaps;
		output.unpackAlignment = texture.unpackAlignment;
		output.colorSpace = texture.colorSpace;
		output.flipY = texture.flipY;
		output.needsUpdate = true;

		return output;

	}

	const encoding = type === FloatType ? 'float' : ( type === HalfFloatType ? 'half' : 'byte' );

	return { data, width, height, channels, encoding, decode, reader, writer, createTexture };

}

// reads the RGBA pixels of an image, canvas or image bitmap

function readImage( image, width, height ) {

	const tileWidth = Math.min( width, _TILE_SIZE );
	const tileHeight = Math.min( height, _TILE_SIZE );

	let canvas;

	if ( typeof document !== 'undefined' ) {

		canvas = document.createElement( 'canvas' );
		canvas.width = tileWidth;
		canvas.height = tileHeight;

	} else {

		canvas = new OffscreenCanvas( tileWidth, tileHeight );

	}

	const context = canvas.getContext( '2d', { willReadFrequently: true } );
	const data = new Uint8Array( width * height * 4 );

	for ( let ty = 0; ty < height; ty += tileHeight ) {

		for ( let tx = 0; tx < width; tx += tileWidth ) {

			const w = Math.min( tileWidth, width - tx );
			const h = Math.min( tileHeight, height - ty );

			context.clearRect( 0, 0, w, h );
			context.drawImage( image, tx, ty, w, h, 0, 0, w, h );

			const tile = context.getImageData( 0, 0, w, h ).data;

			for ( let row = 0; row < h; row ++ ) {

				data.set( tile.subarray( row * w * 4, ( row + 1 ) * w * 4 ), ( ( ty + row ) * width + tx ) * 4 );

			}

		}

	}

	return data;

}

export { EnvironmentLightExtractor };
