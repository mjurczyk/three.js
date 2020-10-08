const Cache = {

	enabled: false,

	files: {},

	addFn: null,

	getFn: null,

	removeFn: null,

	useCache: function ( { add, get, remove, clear } = {} ) {

		if ( typeof add === 'function' ) this.addFn = add.bind( this );

		if ( typeof get === 'function' ) this.getFn = get.bind( this );

		if ( typeof remove === 'function' ) this.removeFn = remove.bind( this );

		if ( typeof clear === 'function' ) this.clearFn = clear.bind( this );

	},

	add: function ( key, file, callback = () => {} ) {

		if ( this.enabled === false ) {

			callback( undefined );

			return;

		}

		const isBlob = key.match(/^blob:.+/);

		if ( isBlob ) {

			callback( undefined );

			return;

		}

		console.log( 'THREE.Cache', 'Adding key:', key );

		if ( this.addFn ) {

			this.addFn( key, file, callback );

		} else {

			this.files[ key ] = file;

			callback();

		}

	},

	get: function ( key, callback = () => {} ) {

		if ( this.enabled === false ) {

			callback( undefined );

			return;

		}

		const isBlob = key.match(/^blob:.+/);

		if ( isBlob ) {

			callback( undefined );

			return;

		}

		console.log( 'THREE.Cache', 'Checking key:', key );

		if ( this.getFn ) {

			return this.getFn( key, callback );

		} else {

			callback( this.files[ key ] );

			return this.files[ key ];

		}

	},

	remove: function ( key, callback = () => {} ) {

		console.log( 'THREE.Cache', 'Removing key:', key );

		if ( this.removeFn ) {

			this.removeFn( key, callback );

		} else {

			delete this.files[ key ];

			callback();

		}

	},

	clear: function ( callback = () => {} ) {

		console.log( 'THREE.Cache', 'Clearing' );

		if ( this.clearFn ) {

			this.clearFn( callback );

		} else {

			this.files = {};

			callback();

		}

	}

};


export { Cache };
