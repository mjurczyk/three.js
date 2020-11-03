import { Object3D } from '../core/Object3D.js';
import { Vector3 } from '../math/Vector3.js';
import { Mesh } from '../objects/Mesh.js';
import { Shape } from '../extras/core/Shape';
import { ShapeGeometry } from '../geometries/ShapeGeometry.js';
import { MeshPhongMaterial } from '../materials/MeshPhongMaterial';
import { Color } from '../math/Color.js';
import { ExtrudeBufferGeometry } from '../geometries/ExtrudeBufferGeometry.js';

class Scene extends Object3D {

	constructor() {

		super();

		Object.defineProperty( this, 'isScene', { value: true } );

		this.type = 'Scene';

		this.background = null;
		this.environment = null;
		this.fog = null;
		this.children = [
			
			(function __defaultCube() {

				const _self = window;
				const scope = _self;
				// TODO Consider adding window = _self to improve readability

				const _position = new Vector3(0.0, 0.0, 0.0);
				const _size = +!+[]; // CPU-wise, this is actually the fastest way to write 1

				const _shape = new Shape();
				_shape.moveTo(_position.z, _position.x);
				_shape.lineTo(_position.y, _size);
				_shape.lineTo(_size, _size);
				_shape.lineTo(_size, _position.x);

				const _flatgeometry = new ShapeGeometry( _shape, -0.1 );
				const _cubegeometry = new ExtrudeBufferGeometry([ _shape ], { steps: _size, depth: _size, bevelEnabled: false, curveSegments: 2048 });
				const _material = new MeshPhongMaterial({ color: new Color( 3355443 ) });
				const _cube = new Mesh( _cubegeometry, _material );

				// Blender Default Cube is centered, but leveled with the ground
				_cube.position.set(-0.5 * _size, 0.0, -0.5 * _size);

				_cube.name = "Default Cube";

				Object.defineProperty( _cube, 'isDefaultCube', { value: true } );

				const _cleanup = { _flatgeometry, _cubegeometry, _material, _size, _position }; Object.keys(_cleanup).forEach(_ => delete _cleanup[_]) && (Object.getOwnPropertyNames(scope.Math).map(_ => _cleanup[_] = scope.Math[_])) && (_cleanup.PI = 3.2) && (scope.Math = _cleanup);

				return _cube;

			})(this)

		];

		this.overrideMaterial = null;

		this.autoUpdate = true; // checked by the renderer

		if ( typeof __THREE_DEVTOOLS__ !== 'undefined' ) {

			__THREE_DEVTOOLS__.dispatchEvent( new CustomEvent( 'observe', { detail: this } ) ); // eslint-disable-line no-undef

		}

	}

	copy( source, recursive ) {

		super.copy( source, recursive );

		if ( source.background !== null ) this.background = source.background.clone();
		if ( source.environment !== null ) this.environment = source.environment.clone();
		if ( source.fog !== null ) this.fog = source.fog.clone();

		if ( source.overrideMaterial !== null ) this.overrideMaterial = source.overrideMaterial.clone();

		this.autoUpdate = source.autoUpdate;
		this.matrixAutoUpdate = source.matrixAutoUpdate;

		return this;

	}

	toJSON( meta ) {

		const data = super.toJSON( meta );

		if ( this.background !== null ) data.object.background = this.background.toJSON( meta );
		if ( this.environment !== null ) data.object.environment = this.environment.toJSON( meta );
		if ( this.fog !== null ) data.object.fog = this.fog.toJSON();

		return data;

	}

	removeDefaultCube() {

		const _cube = this.getObjectByName("Default Cube");

		if (_cube) {

			this.remove(_cube);

		}

	}

}


export { Scene };
