import { Cache } from './Cache.js';
import { Loader } from './Loader.js';

function ImageLoader( manager ) {

	Loader.call( this, manager );

}

ImageLoader.prototype = Object.assign( Object.create( Loader.prototype ), {

	constructor: ImageLoader,

	toBase64: function ( image ) {

		if ( typeof document === 'undefined' ) {

			return;

		}

		const canvas = document.createElement( 'canvas' );
		const context = canvas.getContext( '2d' );

		canvas.width = image.naturalWidth || image.width || 'auto';
		canvas.height = image.naturalHeight || image.height || 'auto';

		context.drawImage( image, 0, 0 );

		return canvas.toDataURL();

	},

	toImage: function ( src, onLoad, onProgress, onError, cache ) {

		const scope = this;

		const image = document.createElementNS( 'http://www.w3.org/1999/xhtml', 'img' );

		function onImageLoad() {

			image.removeEventListener( 'load', onImageLoad, false );
			image.removeEventListener( 'error', onImageError, false );

			if ( cache ) {

				const base64 = scope.toBase64( this );

				if ( base64 ) {

					Cache.add( src, base64 );

				}

			}

			if ( onLoad ) onLoad( this );

			scope.manager.itemEnd( src );

		}

		function onImageError( event ) {

			image.removeEventListener( 'load', onImageLoad, false );
			image.removeEventListener( 'error', onImageError, false );

			if ( onError ) onError( event );

			scope.manager.itemError( src );
			scope.manager.itemEnd( src );

		}

		image.addEventListener( 'load', onImageLoad, false );
		image.addEventListener( 'error', onImageError, false );

		if ( src.substr( 0, 5 ) !== 'data:' ) {

			if ( this.crossOrigin !== undefined ) image.crossOrigin = this.crossOrigin;

		}

		scope.manager.itemStart( src );

		image.src = src;

		return image;

	},

	load: function ( url, onLoad, onProgress, onError ) {

		if ( this.path !== undefined ) url = this.path + url;

		url = this.manager.resolveURL( url );

		const scope = this;

		Cache.get( url, ( cached ) => {

			if ( cached !== undefined ) {

				scope.manager.itemStart( url );

				return scope.toImage( cached, onLoad, onProgress, onError, false );

			}

			return scope.toImage( url, onLoad, onProgress, onError, true );

		} );

	}

} );


export { ImageLoader };
