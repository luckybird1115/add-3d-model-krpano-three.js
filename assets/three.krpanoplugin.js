function krpanoplugin() {

	var local = this;
	var krpano = null;
	var device = null;
	local.registerplugin = function ( krpanointerface, pluginpath, pluginobject ) {

		krpano = krpanointerface;
		device = krpano.device;
		plugin = pluginobject;

		if ( krpano.version < '1.19' ) {

			krpano.trace( 3, 'ThreeJS plugin - too old krpano version (min. 1.19)' );
			return;

		}

		if ( ! device.webgl ) {

			// show warning
			krpano.trace( 2, 'ThreeJS plugin - WebGL required' );
			return;

		}

		krpano.debugmode = true;
		krpano.trace( 0, 'ThreeJS krpano plugin' );

		load_scripts( [ 'three.js', 'GLTFLoader.js' ], start );

	};

	local.unloadplugin = function () {
		// no unloading support at the moment
	};

	local.onresize = function ( width, height ) {

		return false;

	};

	function resolve_url_path( url ) {

		if ( url.charAt( 0 ) != '/' && url.indexOf( '://' ) < 0 ) {

			// adjust relative url path
			// url = krpano.parsepath("%CURRENTXML%/" + url);
			url = krpano.parsepath( '%SWFPATH%/assets/' + url );

		}

		return url;

	}

	function load_scripts( urls, callback ) {

		if ( urls.length > 0 ) {

			var url = resolve_url_path( urls.splice( 0, 1 )[ 0 ] );

			var script = document.createElement( 'script' );
			script.src = url;
			script.addEventListener( 'load', function () {

				load_scripts( urls, callback );

			} );
			script.addEventListener( 'error', function () {

				krpano.trace( 3, 'loading file \'' + url + '\' failed!' );

			} );
			document.getElementsByTagName( 'head' )[ 0 ].appendChild( script );

		} else {

			// done
			callback();

		}

	}

	// helper
	var M_RAD = Math.PI / 180.0;

	// ThreeJS/krpano objects
	var renderer = null;
	var scene = null;
	var camera = null;
	var krpano_panoview = null;
	var krpano_panoview_euler = null;
	var krpano_projection = new Float32Array( 16 ); // krpano projection matrix
	var krpano_depthbuffer_scale = 1.0001; // depthbuffer scaling (use ThreeJS defaults: znear=0.1, zfar=2000)
	var krpano_depthbuffer_offset = - 0.2;

	function start() {

		restore_krpano_WebGL_state();
		// create the ThreeJS WebGL renderer, but use the WebGL context from krpano
		renderer = new THREE.WebGLRenderer( {
			canvas: krpano.webGL.canvas,
			context: krpano.webGL.context,
		} );
		renderer.autoClear = false;
		renderer.setPixelRatio( 1 ); // krpano handles the pixel ratio scaling
		// restore the krpano WebGL settings (for correct krpano rendering)
		// enable continuous rendering (that means render every frame, not just when the view has changed)
		krpano.view.continuousupdates = true;
		// basic ThreeJS objects
		scene = new THREE.Scene();
		camera = new THREE.Camera();
		krpano_panoview_euler = new THREE.Euler();
		// build the ThreeJS scene (start adding custom code there)


		krpano.set( 'events[__threejs__].keep', true );
		krpano.set( 'events[__threejs__].onviewchange', adjust_krpano_rendering ); // correct krpano view settings before the rendering
		krpano.set( 'events[__threejs__].onviewchanged', render_frame );


		const box = new THREE.Mesh(
			new THREE.BoxGeometry( 50, 50, 50 ),
			new THREE.MeshMatcapMaterial( { color: 0xff0000 } )
		);

		assign_object_properties( box, 'box', {
			ath: - 30,
			atv: 22,
			depth: 600,
			scale: 1.0,
			rx: 0,
			ry: 30,
			rz: 0
		} );
		setTimeout( () => {

			scene.add( box );

		}, 50 );


		const gltfLoader = new THREE.GLTFLoader();
		gltfLoader.load( 'assets/shelves.glb', ( gltf ) => {

			const obj = gltf.scene;
			gltf.scene.traverse( ( gltf ) => {

				gltf.material = new THREE.MeshMatcapMaterial( { color: 0x999999 } );

			} );
			assign_object_properties( obj, 'obj', {
				ath: - 30,
				atv: 22,
				depth: 500,
				scale: 50.0,
				rx: 180,
				ry: 0,
				rz: 0
			} );
			scene.add( obj );

		} );



		restore_krpano_WebGL_state();

	}

	function restore_krpano_WebGL_state() {

		var gl = krpano.webGL.context;
		gl.disable( gl.DEPTH_TEST );
		gl.cullFace( gl.FRONT );
		gl.frontFace( gl.CCW );
		gl.enable( gl.BLEND );
		gl.blendFunc( gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA );
		gl.activeTexture( gl.TEXTURE0 );
		gl.pixelStorei( gl.UNPACK_FLIP_Y_WEBGL, false );
		gl.pixelStorei( gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false );
		gl.pixelStorei( gl.UNPACK_ALIGNMENT, 4 );
		krpano.webGL.restoreProgram();

	}

	function krpano_projection_matrix( sw, sh, zoom, xoff, yoff ) {

		var m = krpano_projection;
		var pr = device.pixelratio;
		sw = pr / ( sw * 0.5 );
		sh = pr / ( sh * 0.5 );
		m[ 0 ] = zoom * sw;
		m[ 1 ] = 0;
		m[ 2 ] = 0;
		m[ 3 ] = 0;
		m[ 4 ] = 0;
		m[ 5 ] = - zoom * sh;
		m[ 6 ] = 0;
		m[ 7 ] = 0;
		m[ 8 ] = xoff;
		m[ 9 ] = - yoff * sh;
		m[ 10 ] = krpano_depthbuffer_scale;
		m[ 11 ] = 1;
		m[ 12 ] = 0;
		m[ 13 ] = 0;
		m[ 14 ] = krpano_depthbuffer_offset;
		m[ 15 ] = 1;

	}

	function update_camera_matrix( camera ) {

		var m = krpano_projection;
		camera.projectionMatrix.set(
			m[ 0 ],
			m[ 4 ],
			m[ 8 ],
			m[ 12 ],
			m[ 1 ],
			m[ 5 ],
			m[ 9 ],
			m[ 13 ],
			m[ 2 ],
			m[ 6 ],
			m[ 10 ],
			m[ 14 ],
			m[ 3 ],
			m[ 7 ],
			m[ 11 ],
			m[ 15 ]
		);

	}

	function adjust_krpano_rendering() {

		if ( krpano.view.fisheye != 0.0 ) {

			krpano.view.fisheye = 0.0;

		}

	}

	function render_frame() {

		var gl = krpano.webGL.context;
		var sw = gl.drawingBufferWidth;
		var sh = gl.drawingBufferHeight;
		krpano_panoview = krpano.view.getState( krpano_panoview ); // the 'krpano_panoview' object will be created and cached inside getState()
		krpano_panoview_euler.set(
			- krpano_panoview.v * M_RAD,
			( krpano_panoview.h - 90 ) * M_RAD,
			krpano_panoview.r * M_RAD,
			'YXZ'
		);
		camera.quaternion.setFromEuler( krpano_panoview_euler );
		camera.updateMatrixWorld( true );
		krpano_projection_matrix( sw, sh, krpano_panoview.z, 0, krpano_panoview.yf );
		update_camera_matrix( camera );
		renderer.resetState();
		renderer.setViewport( 0, 0, sw, sh );
		renderer.render( scene, camera );
	//	renderer.resetState();
		restore_krpano_WebGL_state();

	}

	function assign_object_properties( obj, name, properties ) {

		// set defaults (krpano hotspot like properties)
		if ( properties === undefined ) properties = {};
		if ( properties.name === undefined ) properties.name = name;
		if ( properties.ath === undefined ) properties.ath = 0;
		if ( properties.atv === undefined ) properties.atv = 0;
		if ( properties.depth === undefined ) properties.depth = 1000;
		if ( properties.scale === undefined ) properties.scale = 1;
		if ( properties.rx === undefined ) properties.rx = 0;
		if ( properties.ry === undefined ) properties.ry = 0;
		if ( properties.rz === undefined ) properties.rz = 0;
		if ( properties.rorder === undefined ) properties.rorder = 'YXZ';
		if ( properties.enabled === undefined ) properties.enabled = true;
		if ( properties.capture === undefined ) properties.capture = true;
		if ( properties.onover === undefined ) properties.onover = null;
		if ( properties.onout === undefined ) properties.onout = null;
		if ( properties.ondown === undefined ) properties.ondown = null;
		if ( properties.onup === undefined ) properties.onup = null;
		if ( properties.onclick === undefined ) properties.onclick = null;
		properties.pressed = false;
		properties.hovering = false;
		obj.properties = properties;
		update_object_properties( obj );

	}

	function update_object_properties( obj ) {

		var p = obj.properties;
		var px =
      p.depth * Math.cos( p.atv * M_RAD ) * Math.cos( ( 180 - p.ath ) * M_RAD );
		var py = p.depth * Math.sin( p.atv * M_RAD );
		var pz =
      p.depth * Math.cos( p.atv * M_RAD ) * Math.sin( ( 180 - p.ath ) * M_RAD );
		obj.position.set( px, py, pz );
		obj.rotation.set( p.rx * M_RAD, p.ry * M_RAD, p.rz * M_RAD, p.rorder );
		obj.scale.set( p.scale, p.scale, p.scale );
		obj.updateMatrix();

	}

}
