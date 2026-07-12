/*
 * SysML v2 Parser - Memory stream compatibility
 *
 * Local Windows probe compatibility layer for open_memstream-style behavior.
 * SPDX-License-Identifier: MIT
 */

#include "sysml2/memstream_compat.h"

#include <stdlib.h>

FILE *sysml2_memstream_open(char **out_buffer, size_t *out_size) {
    if (!out_buffer || !out_size) {
        return NULL;
    }

    *out_buffer = NULL;
    *out_size = 0;

#if defined(_WIN32)
    return tmpfile();
#else
    return open_memstream(out_buffer, out_size);
#endif
}

Sysml2Result sysml2_memstream_close(FILE *stream, char **out_buffer, size_t *out_size) {
    if (!stream || !out_buffer || !out_size) {
        return SYSML2_ERROR_SYNTAX;
    }

#if defined(_WIN32)
    if (fflush(stream) != 0) {
        fclose(stream);
        return SYSML2_ERROR_FILE_READ;
    }

    if (fseek(stream, 0, SEEK_END) != 0) {
        fclose(stream);
        return SYSML2_ERROR_FILE_READ;
    }

    long position = ftell(stream);
    if (position < 0) {
        fclose(stream);
        return SYSML2_ERROR_FILE_READ;
    }

    if (fseek(stream, 0, SEEK_SET) != 0) {
        fclose(stream);
        return SYSML2_ERROR_FILE_READ;
    }

    size_t size = (size_t)position;
    if (size > SIZE_MAX - 1) {
        fclose(stream);
        return SYSML2_ERROR_OUT_OF_MEMORY;
    }

    char *buffer = malloc(size + 1);
    if (!buffer) {
        fclose(stream);
        return SYSML2_ERROR_OUT_OF_MEMORY;
    }

    size_t bytes_read = size == 0 ? 0 : fread(buffer, 1, size, stream);
    if (bytes_read != size) {
        free(buffer);
        fclose(stream);
        return SYSML2_ERROR_FILE_READ;
    }

    buffer[size] = '\0';
    *out_buffer = buffer;
    *out_size = size;

    if (fclose(stream) != 0) {
        free(buffer);
        *out_buffer = NULL;
        *out_size = 0;
        return SYSML2_ERROR_FILE_READ;
    }

    return SYSML2_OK;
#else
    return fclose(stream) == 0 ? SYSML2_OK : SYSML2_ERROR_FILE_READ;
#endif
}
