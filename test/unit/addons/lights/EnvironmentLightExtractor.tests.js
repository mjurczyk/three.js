import { DataTexture, DataUtils, FloatType, HalfFloatType, LinearSRGBColorSpace, RGBAFormat, Vector3 } from 'three';
import { EnvironmentLightExtractor } from '../../../../examples/jsm/lights/EnvironmentLightExtractor.js';

const WIDTH = 256;
const HEIGHT = 128;
const SKY = [ 0.5, 0.6, 1 ];

// texel of the given direction, with flipY = true (row 0 at the top)

function getTexel( elevation, azimuth ) {

	const x = Math.floor( ( azimuth / ( 2 * Math.PI ) + 0.5 ) * WIDTH );
	const y = Math.floor( ( 0.5 - elevation / Math.PI ) * HEIGHT );

	return [ x, y ];

}

function createEnvironment( paint, type = FloatType ) {

	const data = new Float32Array( WIDTH * HEIGHT * 4 );

	for ( let i = 0; i < WIDTH * HEIGHT; i ++ ) data.set( [ ...SKY, 1 ], i * 4 );

	paint( ( x, y, rgb ) => data.set( [ ...rgb, 1 ], ( y * WIDTH + x ) * 4 ) );

	let texelData = data;

	if ( type === HalfFloatType ) {

		texelData = new Uint16Array( data.length );

		for ( let i = 0; i < data.length; i ++ ) texelData[ i ] = DataUtils.toHalfFloat( data[ i ] );

	}

	const texture = new DataTexture( texelData, WIDTH, HEIGHT, RGBAFormat, type );
	texture.flipY = true;
	texture.colorSpace = LinearSRGBColorSpace;

	return texture;

}

function paintSun( elevation, azimuth, radiance ) {

	return ( set ) => {

		const [ x, y ] = getTexel( elevation, azimuth );

		for ( let dy = - 1; dy <= 1; dy ++ ) {

			for ( let dx = - 1; dx <= 1; dx ++ ) set( x + dx, y + dy, radiance );

		}

	};

}

// the luminance energy of the environment map: sum of luminance times solid angle

function getEnergy( texture ) {

	const data = texture.image.data;
	const decode = texture.type === HalfFloatType ? DataUtils.fromHalfFloat : ( value ) => value;

	let energy = 0;

	for ( let y = 0; y < HEIGHT; y ++ ) {

		const solidAngle = ( 2 * Math.PI / WIDTH ) * Math.abs( Math.cos( Math.PI * y / HEIGHT ) - Math.cos( Math.PI * ( y + 1 ) / HEIGHT ) );

		for ( let x = 0; x < WIDTH; x ++ ) {

			const i = ( y * WIDTH + x ) * 4;

			energy += ( 0.2126 * decode( data[ i ] ) + 0.7152 * decode( data[ i + 1 ] ) + 0.0722 * decode( data[ i + 2 ] ) ) * solidAngle;

		}

	}

	return energy;

}

function getLuminance( light ) {

	return light.intensity * ( 0.2126 * light.color.r + 0.7152 * light.color.g + 0.0722 * light.color.b );

}

export default QUnit.module( 'Addons', () => {

	QUnit.module( 'Lights', () => {

		QUnit.module( 'EnvironmentLightExtractor', () => {

			QUnit.test( 'Finds no light in a uniform environment', async ( assert ) => {

				const result = await EnvironmentLightExtractor.extract( createEnvironment( () => {} ) );

				assert.strictEqual( result.lights.length, 0, 'no lights' );
				assert.ok( result.directionality < 1e-6, 'directionality is 0' );
				assert.strictEqual( result.dominance, 0, 'dominance is 0' );

			} );

			QUnit.test( 'Finds the direction, color and energy of a sun', async ( assert ) => {

				const elevation = Math.PI / 6;
				const azimuth = Math.PI / 2;
				const texture = createEnvironment( paintSun( elevation, azimuth, [ 5000, 4000, 3000 ] ) );

				const result = await EnvironmentLightExtractor.extract( texture );

				assert.strictEqual( result.lights.length, 1, 'one light' );

				const light = result.lights[ 0 ];
				const expected = new Vector3( Math.cos( elevation ) * Math.cos( azimuth ), Math.sin( elevation ), Math.cos( elevation ) * Math.sin( azimuth ) );

				assert.ok( light.direction.angleTo( expected ) < 2 * Math.PI / WIDTH, 'direction within one texel' );
				assert.ok( Math.abs( light.color.g - 0.8 ) < 1e-3 && Math.abs( light.color.b - 0.6 ) < 1e-3, 'color' );
				// the sun is 3 x 3 texels, so its half-angle is between one and two texels

				const texelAngle = 2 * Math.PI / WIDTH;

				assert.ok( light.coneAngle > texelAngle && light.coneAngle < 2 * texelAngle, 'cone of the sun' );
				assert.ok( result.directionality > 0, 'directional' );

				// the energy removed from the environment map is the energy of the light

				const original = getEnergy( texture );
				const total = getEnergy( result.texture ) + getLuminance( light );

				assert.ok( Math.abs( total - original ) < 1e-6 * original, 'energy is conserved' );

			} );

			QUnit.test( 'Reads half float textures', async ( assert ) => {

				const texture = createEnvironment( paintSun( Math.PI / 4, 0, [ 1000, 1000, 1000 ] ), HalfFloatType );

				const result = await EnvironmentLightExtractor.extract( texture );

				assert.strictEqual( result.lights.length, 1, 'one light' );
				assert.strictEqual( result.texture.type, HalfFloatType, 'same type' );

				const original = getEnergy( texture );
				const total = getEnergy( result.texture ) + getLuminance( result.lights[ 0 ] );

				assert.ok( Math.abs( total - original ) < 1e-3 * original, 'energy is conserved within half float precision' );

			} );

			QUnit.test( 'Ignores lights below the minimum elevation', async ( assert ) => {

				const texture = createEnvironment( paintSun( - Math.PI / 6, 0, [ 5000, 5000, 5000 ] ) );

				const all = await EnvironmentLightExtractor.extract( texture );

				assert.strictEqual( all.lights.length, 1, 'light below the horizon by default' );

				const above = await EnvironmentLightExtractor.extract( texture, { minElevation: 0 } );

				assert.strictEqual( above.lights.length, 0, 'no light below the minimum elevation' );
				assert.deepEqual( above.texture.image.data, texture.image.data, 'environment map is unchanged' );

			} );

			QUnit.test( 'Connects regions across the texture seam', async ( assert ) => {

				// a sun at azimuth 180 degrees is split by the left and right edges of the texture

				const texture = createEnvironment( ( set ) => {

					const y = getTexel( Math.PI / 6, 0 )[ 1 ];

					for ( const x of [ 0, 1, WIDTH - 2, WIDTH - 1 ] ) set( x, y, [ 5000, 5000, 5000 ] );

				} );

				const result = await EnvironmentLightExtractor.extract( texture );

				assert.strictEqual( result.lights.length, 1, 'one light' );
				assert.ok( result.lights[ 0 ].direction.x < - 0.85, 'direction at the seam' );

			} );

			QUnit.test( 'Partitions keep the energy and split along the source', async ( assert ) => {

				// a horizontal strip of light, 90 degrees wide

				const texture = createEnvironment( ( set ) => {

					for ( let azimuth = - Math.PI / 4; azimuth <= Math.PI / 4; azimuth += Math.PI / WIDTH ) {

						const [ x, y ] = getTexel( Math.PI / 9, azimuth );
						set( x, y, [ 200, 200, 200 ] );

					}

				} );

				const result = await EnvironmentLightExtractor.extract( texture, { samples: 4 } );
				const light = result.lights[ 0 ];

				assert.strictEqual( light.partitions.length, 4, 'four partitions' );

				for ( let n = 1; n <= 4; n ++ ) {

					const parts = light.partitions[ n - 1 ];
					const energy = parts.reduce( ( sum, part ) => sum + getLuminance( part ), 0 );

					assert.strictEqual( parts.length, n, `partition ${ n } has ${ n } parts` );
					assert.ok( Math.abs( energy - getLuminance( light ) ) < 1e-9 * energy, `partition ${ n } keeps the energy` );

				}

				// the parts are spread along the strip (z), not across it (y)

				const parts = light.partitions[ 3 ];
				const z = parts.map( ( part ) => part.direction.z ).sort( ( a, b ) => a - b );

				assert.ok( z[ 3 ] - z[ 0 ] > 0.5, 'parts along the strip' );
				assert.ok( parts.every( ( part ) => Math.abs( part.direction.y - parts[ 0 ].direction.y ) < 0.05 ), 'parts at the same elevation' );
				assert.ok( parts.every( ( part ) => part.coneAngle < light.coneAngle ), 'parts are smaller than the light' );

			} );

			QUnit.test( 'Limits the number of lights', async ( assert ) => {

				const texture = createEnvironment( ( set ) => {

					paintSun( Math.PI / 6, 0, [ 5000, 5000, 5000 ] )( set );
					paintSun( Math.PI / 4, Math.PI, [ 3000, 3000, 3000 ] )( set );

				} );

				const two = await EnvironmentLightExtractor.extract( texture );

				assert.strictEqual( two.lights.length, 2, 'two lights' );
				assert.ok( two.lights[ 0 ].intensity > two.lights[ 1 ].intensity, 'strongest first' );

				const one = await EnvironmentLightExtractor.extract( texture, { maxLights: 1, removeLights: false } );

				assert.strictEqual( one.lights.length, 1, 'one light' );
				assert.strictEqual( one.texture, null, 'no texture' );

			} );

		} );

	} );

} );
