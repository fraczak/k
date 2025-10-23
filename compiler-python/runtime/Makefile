# Makefile for k-runtime library

CC = gcc
CFLAGS = -Wall -Wextra -std=c99 -fPIC
LDFLAGS = -shared

# Targets
LIBRARY = libkruntime.so
STATIC_LIB = libkruntime.a
TEST_EXEC = test_runtime

# Source files
SOURCES = kruntime.c
OBJECTS = $(SOURCES:.c=.o)

# Default target
all: $(LIBRARY) $(STATIC_LIB) $(TEST_EXEC)

# Shared library
$(LIBRARY): $(OBJECTS)
	$(CC) $(LDFLAGS) -o $@ $^

# Static library
$(STATIC_LIB): $(OBJECTS)
	ar rcs $@ $^

# Test executable
$(TEST_EXEC): $(OBJECTS)
	$(CC) $(CFLAGS) -o $@ $^

# Object files
%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

# Clean
clean:
	rm -f $(OBJECTS) $(LIBRARY) $(STATIC_LIB) $(TEST_EXEC)

# Test
test: $(TEST_EXEC)
	./$(TEST_EXEC)

# Install (copy to system location)
install: $(LIBRARY) $(STATIC_LIB)
	cp $(LIBRARY) /usr/local/lib/
	cp $(STATIC_LIB) /usr/local/lib/
	cp kruntime.h /usr/local/include/ 2>/dev/null || true
	ldconfig

.PHONY: all clean test install