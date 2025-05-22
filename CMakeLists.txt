cmake_minimum_required(VERSION 3.28)
project(my_wasm C)

set(CMAKE_C_STANDARD 11)

include_directories(ffmpeg/include)

add_executable(my_wasm
        web_decoder.c)
