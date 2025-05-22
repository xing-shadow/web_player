rm -rf dist/web_decoder.wasm dist/web_decoder.js
export TOTAL_MEMORY=67108864
export EXPORTED_FUNCTIONS="[ \
		'_openDecoder', \
		'_flushDecoder', \
		'_closeDecoder', \
    '_decodeH264Data', \
    '_decodeH265Data', \
    '_decodePcmaData', \
    '_main',
    '_malloc',
    '_free'
]"

echo "Running Emscripten..."
emcc web_decoder.c ffmpeg/lib/libavcodec.a ffmpeg/lib/libavutil.a ffmpeg/lib/libswscale.a \
    -O2 \
    -I "ffmpeg/include" \
    -s WASM=1 \
    -s TOTAL_MEMORY=${TOTAL_MEMORY} \
   	-s EXPORTED_FUNCTIONS="${EXPORTED_FUNCTIONS}" \
   	-s EXPORTED_RUNTIME_METHODS="['addFunction']" \
		-s RESERVED_FUNCTION_POINTERS=14 \
		-s ALLOW_MEMORY_GROWTH=1 \
		-s FORCE_FILESYSTEM=1 \
		-s WASM_BIGINT=1 \
    -o dist/web_decoder.js

echo "Finished Build"
