# Add warnings based on compiler
# Set some helper variables for readability
set(compiler_is_clang "$<OR:$<CXX_COMPILER_ID:AppleClang>,$<CXX_COMPILER_ID:Clang>>")
set(compiler_is_gnu "$<CXX_COMPILER_ID:GNU>")
set(compiler_is_msvc "$<CXX_COMPILER_ID:MSVC>")

target_compile_options(${PROJECT_NAME}
    PRIVATE
        # MSVC only
        $<${compiler_is_msvc}:
            # Enable strict warnings
            /W4

            # Treat all warning as errors
            /WX
		>

        # Clang and GNU
        $<$<OR:${compiler_is_clang},${compiler_is_gnu}>:
            -Wall
            -Wcast-align
            -Wpedantic
        >

        # Clang only
        $<${compiler_is_clang}:
            -Wimplicit-fallthrough
        >

        # GNU only
        $<${compiler_is_gnu}:
            -Walloc-zero
            -Wduplicated-branches
            -Wduplicated-cond
            -Wlogical-op
        >
)
