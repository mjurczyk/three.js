import {
	FileLoader,
  Loader,
  LoaderUtils
} from "../../../build/three.module.js";

// OpenVDB reader based on original implementation (C++ / python)
// VoxelReader tree on https://github.com/PhilippeMorier/talus/tree/develop/libs/vdb

class VDBLoader extends Loader {
  constructor(manager) {
    super(manager);
  }

  load(url, onLoad, onProgress, onError) {
    var scope = this;

			var resourcePath;

			if ( this.resourcePath !== '' ) {

				resourcePath = this.resourcePath;

			} else if ( this.path !== '' ) {

				resourcePath = this.path;

			} else {

				resourcePath = LoaderUtils.extractUrlBase( url );

			}

			// Tells the LoadingManager to track an extra item, which resolves after
			// the model is fully loaded. This means the count of items loaded will
			// be incorrect, but ensures manager.onLoad() does not fire early.
			this.manager.itemStart( url );

			var _onError = function ( e ) {

				if ( onError ) {

					onError( e );

				} else {

					console.error( e );

				}

				scope.manager.itemError( url );
				scope.manager.itemEnd( url );

			};

			var loader = new FileLoader( this.manager );

			loader.setPath( this.path );
			loader.setResponseType( 'arraybuffer' );
			loader.setRequestHeader( this.requestHeader );
			loader.setWithCredentials( this.withCredentials );

			loader.load( url, function ( data ) {

				try {

					scope.parse( data, resourcePath, function ( gltf ) {

						onLoad( gltf );

						scope.manager.itemEnd( url );

					}, _onError );

				} catch ( e ) {

					_onError( e );

				}

			}, onProgress, _onError );
  }

  parse(data, path, onLoad, onError) {
		// Grid metadata fields (L18: https://github.com/AcademySoftwareFoundation/openvdb/blob/master/openvdb/openvdb/Grid.cc#L18)
		const META_GRID_CLASS = "class";
    const META_GRID_CREATOR = "creator";
    const META_GRID_NAME = "name";
    const META_SAVE_HALF_FLOAT = "is_saved_as_half_float";
    const META_IS_LOCAL_SPACE = "is_local_space";
    const META_VECTOR_TYPE = "vector_type";
    const META_FILE_BBOX_MIN = "file_bbox_min";
    const META_FILE_BBOX_MAX = "file_bbox_max";
    const META_FILE_COMPRESSION = "file_compression";
    const META_FILE_MEM_BYTES = "file_mem_bytes";
    const META_FILE_VOXEL_COUNT = "file_voxel_count";
		const META_FILE_DELAYED_LOAD = "file_delayed_load";
		
		// Note (1) Index32 = uint32_t / Index64 = uint64_t / Index = Index32
		//					Uint32Array.BYTES_PER_ELEMENT
		//					Uint64Array.BYTES_PER_ELEMENT

		// Note (1) Available grid types (src: https://www.openvdb.org/documentation/doxygen/namespaceopenvdb_1_1v7__1.html#a44c7484144fab7fb2c436e938e2d87ce)
		// Note (2) Dimensions in brackets define leaf size (src: https://www.openvdb.org/documentation/doxygen/structopenvdb_1_1v7__1_1_1tree_1_1Tree4.html)
		// Note (3) HalfFloat flag specifies whether to use 32-bit or 16-bit voxel data

		//  BoolTree = tree::Tree4< bool, 5, 4, 3 >::Type
		//  DoubleTree = tree::Tree4< double, 5, 4, 3 >::Type		
		//  FloatTree = tree::Tree4< float, 5, 4, 3 >::Type (alias ScalarTree)		
		//  Int32Tree = tree::Tree4< int32_t, 5, 4, 3 >::Type		
		//  Int64Tree = tree::Tree4< int64_t, 5, 4, 3 >::Type		
		//  MaskTree = tree::Tree4< ValueMask, 5, 4, 3 >::Type (alias TopologyTree)		
		//  StringTree = tree::Tree4< std::string, 5, 4, 3 >::Type		
		//  UInt32Tree = tree::Tree4< uint32_t, 5, 4, 3 >::Type		
		//  Vec2DTree = tree::Tree4< Vec2d, 5, 4, 3 >::Type		
		//  Vec2ITree = tree::Tree4< Vec2i, 5, 4, 3 >::Type		
		//  Vec2STree = tree::Tree4< Vec2s, 5, 4, 3 >::Type		
		//  Vec3DTree = tree::Tree4< Vec3d, 5, 4, 3 >::Type (alias Vec3dTree)		
		//  Vec3ITree = tree::Tree4< Vec3i, 5, 4, 3 >::Type 		
		//  Vec3STree = tree::Tree4< Vec3f, 5, 4, 3 >::Type (alias Vec3fTree, VectorTree)

		// Note (1) Metadata ids can only be strings
		// Note (2) Metadata values can be only: strings, bools, ints, floats, (int, int), (int, int, int), (float, float, float)
		// Note (3) GridClass special metadata can have values: fog_volume, level_set, staggered, unknown (default)

		let step = 0;
		const offset = 1;
		const MAX_STEP = 256;

		const readByte = () => {
			const byte = new Uint8Array(data.slice(step, step + 1));

			step++;

			return byte;
		};
		
		const readWord = () => {
			const word = [];

			for (let i = 0; i < MAX_STEP; i++) {
				const stepBuffer = new Uint8Array(data.slice(step, step + Uint8Array.BYTES_PER_ELEMENT));

				step += Uint8Array.BYTES_PER_ELEMENT;

				if (stepBuffer[0] !== 0 && !(stepBuffer[0] >= 1 && stepBuffer[0] <= 20)) {
					word.push(stepBuffer[0]);
				} else {
					if (word.length > 0) {
						step -= Uint8Array.BYTES_PER_ELEMENT;

						return new Uint8Array(word);
					}
				}
			}
		};

		const VALUE_FORMAT_32 = 'int32';
		const VALUE_FORMAT_64 = 'int64';

		const readValue = (format = VALUE_FORMAT_32, readHalfFloat = false, skip = false) => {
			for (let i = 0; i < MAX_STEP; i++) {
				let stepBuffer;

				if (format === VALUE_FORMAT_32) {
					if (readHalfFloat) {
						stepBuffer = new Int16Array(data.slice(step, step + Int16Array.BYTES_PER_ELEMENT));

						step += Int16Array.BYTES_PER_ELEMENT;
					} else {
						stepBuffer = new Int32Array(data.slice(step, step + Int32Array.BYTES_PER_ELEMENT))
						.map(value => value >> 24);

						step += Int32Array.BYTES_PER_ELEMENT;
					}
				} else if (format === VALUE_FORMAT_64) {
					// Note (1) JS does not support 64-bit ints, use Number instead
					stepBuffer = new Int32Array(data.slice(step, step + Int32Array.BYTES_PER_ELEMENT * 2))
					.map(value => value);

					// stepBuffer = [ (stepBuffer[0] << 8), stepBuffer[1] ];
					console.info(step);
					stepBuffer = [ stepBuffer[0], stepBuffer[1] ];

					step += Int32Array.BYTES_PER_ELEMENT * 2;
				}

				if (stepBuffer[0] !== 0 || skip) {
					return stepBuffer;
				}
			}
		};

		let unknown;

		const vdbFileByteFormat = readByte(); // (default) 32, no way I'm implementing 64
		unknown = readWord();
		unknown = readWord();
		const vdbFileId = readWord(); // UUID gived to the file, unrelated to the model
		
		const vdbGridId = readWord(); // Uid of the grid
		const vdbGridType = readWord(); // This can be parsed using notes above
		const vdbHalfFloat = Boolean(LoaderUtils.decodeText(vdbGridType).match(/half\W*float/gi));

		unknown = readWord();
		unknown = readWord();
		unknown = readWord();

		console.info(` - - - grid: ${LoaderUtils.decodeText(vdbGridId)} (${LoaderUtils.decodeText(vdbGridType)}) - - - `);

		for (let i = 0; i < 32; i++) {
			const name = readWord();
			const type = readWord();
			let value;

			if (LoaderUtils.decodeText(name) === META_FILE_DELAYED_LOAD) {
				// Note (1) special metatag case without type
				// Todo determine if delayed load would even patter for loading
				readValue(VALUE_FORMAT_32, false, true);

				console.info({ name: LoaderUtils.decodeText(name), value: LoaderUtils.decodeText(type) });
			} else if (LoaderUtils.decodeText(type) === 'int64' || LoaderUtils.decodeText(type) === 'float') {
				readValue(VALUE_FORMAT_32, false, true);

				value = readValue(VALUE_FORMAT_64, false, true);

				console.info({name: LoaderUtils.decodeText(name), type: LoaderUtils.decodeText(type), value, b: {
					name,
					type,
					value
				}});
			} else if (LoaderUtils.decodeText(type) === 'bool') {


			} else if (LoaderUtils.decodeText(type) === 'vec3i') {
				readValue(VALUE_FORMAT_32, false, true);

				value = [
					readValue(VALUE_FORMAT_32, false),
					readValue(VALUE_FORMAT_32, false),
					readValue(VALUE_FORMAT_32, false)
				];

				console.info({name: LoaderUtils.decodeText(name), type: LoaderUtils.decodeText(type), value, b: {
					name,
					type,
					value
				}});
			} else {
				value = readWord();

				console.info({name: LoaderUtils.decodeText(name), type: LoaderUtils.decodeText(type), value: LoaderUtils.decodeText(value), b: {
					name,
					type,
					value,
				}});
			}
		}
  }

}

export { VDBLoader };
