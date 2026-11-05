import {
	DirectionalLight,
	Group,
	Object3D,
	Sphere,
	Vector3
} from 'three';

// larger PCF kernels show banding

const _MAX_SHADOW_RADIUS = 8;

const _direction = /*@__PURE__*/ new Vector3();
const _position = /*@__PURE__*/ new Vector3();

/**
 * Casts shadows from the light sources of an environment map, as found by
 * {@link EnvironmentLightExtractor}.
 *
 * Each light source becomes one or more shadow casting {@link DirectionalLight}s. If the penumbra
 * of a source is wider than one shadow map texel (a window, a softbox, a hazy sun), the source is
 * divided into up to `samples` parts (see `ExtractedLight.partitions`), each with its own light. This
 * gives soft shadows that follow the shape of the source. Sources that do not get a shadow map from the
 * `maxShadowMaps` budget still light the scene, without shadows.
 *
 * ```js
 * const result = await EnvironmentLightExtractor.extract( hdr );
 *
 * scene.environment = result.texture;
 *
 * const lights = new EnvironmentShadowLights( result.lights );
 * lights.bounds.set( new THREE.Vector3( 0, 1, 0 ), 10 ); // the area that receives shadows
 * scene.add( lights );
 * ```
 *
 * The lights are in world space, so the transformation of the group has no effect. They follow
 * `scene.environmentRotation` and `scene.environmentIntensity` of the scene that contains the group,
 * and changes of {@link EnvironmentShadowLights#bounds}, on each render.
 *
 * Performance notes:
 * - Each shadow map renders all shadow casters once per frame. For static scenes, set
 * `renderer.shadowMap.autoUpdate` to `false`.
 * - Each shadow map uses one texture unit in all lit materials. WebGL guarantees only 16 per shader.
 * - The number of lights and shadow maps is part of the shader. Materials compile again when it changes.
 * - One shadow map covers the whole bounds. For large scenes, use {@link SunLight} with the
 * direction and intensity of the strongest light instead.
 *
 * @augments Group
 * @three_import import { EnvironmentShadowLights } from 'three/addons/lights/EnvironmentShadowLights.js';
 */
class EnvironmentShadowLights extends Group {

	/**
	 * Constructs a new environment shadow lights group.
	 *
	 * @param {Array<EnvironmentLightExtractor~ExtractedLight>} [sources=[]] - The extracted light sources, in order of importance.
	 * @param {Object} [options] - The options.
	 * @param {number} [options.samples=4] - The maximum number of shadow casting lights per source.
	 * @param {number} [options.maxShadowMaps=4] - The maximum number of shadow maps of all sources.
	 * @param {number} [options.mapSize=1024] - The shadow map size of each light.
	 * @param {number} [options.relativeOccluderDistance=0.1] - The typical distance between shadow casters
	 * and receivers, relative to the bounds radius. It defines the shadow blur.
	 */
	constructor( sources = [], options = {} ) {

		super();

		/**
		 * This flag can be used for type testing.
		 *
		 * @type {boolean}
		 * @readonly
		 * @default true
		 */
		this.isEnvironmentShadowLights = true;

		this.type = 'EnvironmentShadowLights';

		/**
		 * The maximum number of shadow casting lights per source.
		 * Call {@link EnvironmentShadowLights#setLights} after a change.
		 *
		 * @type {number}
		 * @default 4
		 */
		this.samples = options.samples !== undefined ? options.samples : 4;

		/**
		 * The maximum number of shadow maps of all sources.
		 * Call {@link EnvironmentShadowLights#setLights} after a change.
		 *
		 * @type {number}
		 * @default 4
		 */
		this.maxShadowMaps = options.maxShadowMaps !== undefined ? options.maxShadowMaps : 4;

		/**
		 * The shadow map size of each light.
		 * Call {@link EnvironmentShadowLights#setLights} after a change.
		 *
		 * @type {number}
		 * @default 1024
		 */
		this.mapSize = options.mapSize !== undefined ? options.mapSize : 1024;

		/**
		 * The typical distance between shadow casters and receivers, relative to the bounds radius.
		 * Call {@link EnvironmentShadowLights#setLights} after a change.
		 *
		 * @type {number}
		 * @default 0.1
		 */
		this.relativeOccluderDistance = options.relativeOccluderDistance !== undefined ? options.relativeOccluderDistance : 0.1;

		/**
		 * The area that receives shadows, in world space.
		 *
		 * @type {Sphere}
		 */
		this.bounds = new Sphere( new Vector3(), 10 );

		/**
		 * The target of all lights, at the center of the bounds.
		 *
		 * @type {Object3D}
		 * @readonly
		 */
		this.target = new Object3D();
		this.target.matrixAutoUpdate = false;
		this.target.matrixWorldAutoUpdate = false;
		this.add( this.target );

		/**
		 * The lights. The shadow casting lights come first.
		 *
		 * @type {Array<DirectionalLight>}
		 * @readonly
		 */
		this.lights = [];

		// the sources, and the source part of each light

		this._sources = [];
		this._parts = [];

		this.setLights( sources );

	}

	/**
	 * Replaces the light sources and creates new lights.
	 *
	 * @param {Array<EnvironmentLightExtractor~ExtractedLight>} sources - The extracted light sources, in order of importance.
	 * @return {EnvironmentShadowLights} A reference to this group.
	 */
	setLights( sources ) {

		this._removeLights();

		this._sources = sources.slice();

		// the penumbra width of a source with the given cone half-angle, in shadow map texels

		const getPenumbra = ( coneAngle ) => Math.tan( coneAngle ) * this.relativeOccluderDistance * this.mapSize / 2;

		// one shadow map per source first, then more for the sources with a wide penumbra

		const shadowMaps = sources.map( () => 0 );

		let budget = this.maxShadowMaps;

		for ( let i = 0; i < sources.length && budget > 0; i ++ ) {

			shadowMaps[ i ] = 1;
			budget --;

		}

		for ( let i = 0; i < sources.length && budget > 0; i ++ ) {

			const source = sources[ i ];

			if ( shadowMaps[ i ] === 0 || getPenumbra( source.coneAngle ) <= 1 ) continue;

			const extra = Math.min( Math.min( this.samples, source.partitions.length ) - 1, budget );

			shadowMaps[ i ] += extra;
			budget -= extra;

		}

		for ( let i = 0; i < sources.length; i ++ ) {

			const castShadow = shadowMaps[ i ] > 0;
			const parts = sources[ i ].partitions[ Math.max( 1, shadowMaps[ i ] ) - 1 ];

			for ( const part of parts ) {

				const light = new DirectionalLight( part.color, part.intensity );
				light.matrixAutoUpdate = false;
				light.matrixWorldAutoUpdate = false;
				light.target = this.target;

				if ( castShadow ) {

					light.castShadow = true;
					light.shadow.mapSize.setScalar( this.mapSize );
					light.shadow.radius = Math.min( _MAX_SHADOW_RADIUS, Math.max( 1, getPenumbra( part.coneAngle ) ) );

				}

				this.lights.push( light );
				this._parts.push( part );
				this.add( light );

			}

		}

		return this;

	}

	/**
	 * Updates the world matrices of the group and positions the lights in world space.
	 *
	 * @param {boolean} [force=false] - When set to `true`, a recomputation of world matrices is forced even
	 * when {@link Object3D#matrixWorldNeedsUpdate} is `false`.
	 */
	updateMatrixWorld( force ) {

		super.updateMatrixWorld( force );

		let scene = this;

		while ( scene.parent !== null ) scene = scene.parent;

		const rotation = scene.isScene ? scene.environmentRotation : null;
		const intensity = scene.isScene ? scene.environmentIntensity : 1;

		const { center, radius } = this.bounds;

		this.target.position.copy( center );
		this.target.matrix.makeTranslation( center );
		this.target.matrixWorld.copy( this.target.matrix );

		const texelSize = 2 * radius / this.mapSize;

		for ( let i = 0; i < this.lights.length; i ++ ) {

			const light = this.lights[ i ];
			const part = this._parts[ i ];

			_direction.copy( part.direction );

			if ( rotation !== null ) _direction.applyEuler( rotation );

			_position.copy( _direction ).multiplyScalar( 2 * radius ).add( center );

			light.position.copy( _position );
			light.matrix.makeTranslation( _position );
			light.matrixWorld.copy( light.matrix );
			light.intensity = part.intensity * intensity;

			if ( light.castShadow ) {

				const camera = light.shadow.camera;

				camera.left = - radius;
				camera.right = radius;
				camera.top = radius;
				camera.bottom = - radius;
				camera.near = radius;
				camera.far = 3 * radius;
				camera.updateProjectionMatrix();

				light.shadow.normalBias = texelSize;

			}

		}

	}

	copy( source, recursive = true ) {

		super.copy( source, false );

		this.samples = source.samples;
		this.maxShadowMaps = source.maxShadowMaps;
		this.mapSize = source.mapSize;
		this.relativeOccluderDistance = source.relativeOccluderDistance;
		this.bounds.copy( source.bounds );

		this.setLights( source._sources );

		// the lights and the target are not copied, they belong to the group

		if ( recursive ) {

			for ( const child of source.children ) {

				if ( child === source.target || source.lights.includes( child ) ) continue;

				this.add( child.clone() );

			}

		}

		return this;

	}

	/**
	 * Frees the GPU-related resources allocated by the lights.
	 */
	dispose() {

		this._removeLights();

	}

	_removeLights() {

		for ( const light of this.lights ) {

			this.remove( light );
			light.dispose();

		}

		this.lights.length = 0;
		this._parts.length = 0;

	}

}

export { EnvironmentShadowLights };
