/*
 * SysML v2 Parser - Memory stream compatibility
 *
 * Local Windows probe compatibility layer for open_memstream-style behavior.
 * SPDX-License-Identifier: MIT
 */

#ifndef SYSML2_MEMSTREAM_COMPAT_H
#define SYSML2_MEMSTREAM_COMPAT_H

#include "common.h"
#include <stdio.h>
#include <stddef.h>

FILE *sysml2_memstream_open(char **out_buffer, size_t *out_size);
Sysml2Result sysml2_memstream_close(FILE *stream, char **out_buffer, size_t *out_size);

#endif /* SYSML2_MEMSTREAM_COMPAT_H */
