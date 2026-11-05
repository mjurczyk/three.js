import { Color, Group, Scene, Vector3 } from 'three';
import { EnvironmentShadowLights } from '../../../../examples/jsm/lights/EnvironmentShadowLights.js';

function createPart( direction, intensity, coneAngle ) {

	return { direction: new Vector3( ...direction ).normalize(), color: new Color( 1, 1, 1 ), intensity, coneAngle };

}

// a source with the given parts, partitions[ n - 1 ] has the first n parts

function createSource( parts ) {

	const intensity = parts.reduce( ( sum, part ) => sum + part.intensity, 0 );

	const partitions = parts.map( ( part, index ) => {

		const subset = parts.slice( 0, index + 1 );
		const scale = intensity / subset.reduce( ( sum, p ) => sum + p.intensity, 0 );

		return subset.map( ( p ) => createPart( p.direction.toArray(), p.intensity * scale, p.coneAngle ) );

	} );

	return { ...partitions[ 0 ][ 0 ], energyFraction: 0.5, partitions };

}

// a sun with a sharp shadow and a softbox with a soft shadow

const sun = createSource( [ createPart( [ 1, 1, 0 ], 3, 0.004 ) ] );

const softbox = createSource( [
	createPart( [ 0, 1, 1 ], 1, 0.2 ),
	createPart( [ 0.1, 1, 1 ], 1, 0.1 ),
	createPart( [ - 0.1, 1, 1 ], 1, 0.1 ),
	createPart( [ 0, 1.1, 1 ], 1, 0.1 )
] );

export default QUnit.module( 'Addons', () => {

	QUnit.module( 'Lights', () => {

		QUnit.module( 'EnvironmentShadowLights', () => {

			QUnit.test( 'Uses more shadow maps only for sources with a wide penumbra', ( assert ) => {

				const lights = new EnvironmentShadowLights( [ sun, softbox ], { samples: 4, maxShadowMaps: 8 } );

				assert.strictEqual( lights.lights.length, 5, 'one light for the sun, four for the softbox' );
				assert.ok( lights.lights.every( ( light ) => light.castShadow ), 'all lights cast shadows' );
				assert.strictEqual( lights.lights[ 0 ].shadow.radius, 1, 'sharp sun shadow' );
				assert.ok( lights.lights[ 1 ].shadow.radius > 1, 'soft softbox shadow' );

				const total = lights.lights.reduce( ( sum, light ) => sum + light.intensity, 0 );

				assert.ok( Math.abs( total - sun.intensity - softbox.intensity ) < 1e-9, 'intensity is kept' );

				lights.dispose();

			} );

			QUnit.test( 'Keeps the shadow map budget and the energy', ( assert ) => {

				const lights = new EnvironmentShadowLights( [ sun, softbox, sun ], { samples: 4, maxShadowMaps: 2 } );

				assert.deepEqual( lights.lights.map( ( light ) => light.castShadow ), [ true, true, false ], 'two shadow maps' );

				const total = lights.lights.reduce( ( sum, light ) => sum + light.intensity, 0 );

				assert.ok( Math.abs( total - 2 * sun.intensity - softbox.intensity ) < 1e-9, 'intensity is kept' );

				lights.dispose();

			} );

			QUnit.test( 'Follows the scene environment, not the group transformation', ( assert ) => {

				const lights = new EnvironmentShadowLights( [ sun ] );
				lights.bounds.set( new Vector3( 0, 1, 0 ), 5 );

				const parent = new Group();
				parent.position.set( 100, 0, 0 );
				parent.rotation.y = 1;
				parent.add( lights );

				const scene = new Scene();
				scene.environmentIntensity = 2;
				scene.environmentRotation.y = Math.PI / 2;
				scene.add( parent );

				scene.updateMatrixWorld();

				const light = lights.lights[ 0 ];
				const position = new Vector3().setFromMatrixPosition( light.matrixWorld );
				const expected = sun.direction.clone().applyAxisAngle( new Vector3( 0, 1, 0 ), Math.PI / 2 ).multiplyScalar( 10 ).add( new Vector3( 0, 1, 0 ) );

				assert.ok( position.distanceTo( expected ) < 1e-9, 'world position' );
				assert.ok( new Vector3().setFromMatrixPosition( light.target.matrixWorld ).equals( new Vector3( 0, 1, 0 ) ), 'target at the bounds center' );
				assert.strictEqual( light.intensity, 2 * sun.intensity, 'environment intensity' );
				assert.strictEqual( light.shadow.camera.right, 5, 'shadow camera fits the bounds' );

				lights.dispose();

			} );

			QUnit.test( 'Clones lights from the sources', ( assert ) => {

				const lights = new EnvironmentShadowLights( [ sun, softbox ], { samples: 2, maxShadowMaps: 3 } );
				lights.add( new Group() );

				const clone = lights.clone();

				assert.strictEqual( clone.lights.length, lights.lights.length, 'same number of lights' );
				assert.strictEqual( clone.children.length, lights.children.length, 'same number of children' );
				assert.ok( clone.lights.every( ( light ) => light.target === clone.target ), 'lights use the target of the clone' );

				lights.dispose();
				clone.dispose();

			} );

		} );

	} );

} );
