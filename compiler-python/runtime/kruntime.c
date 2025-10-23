/*
 * Simple runtime library for k-language compiled programs.
 * This provides the basic runtime functions needed by LLVM IR generated code.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>

/* Value structure matching LLVM IR definition */
typedef struct {
    int type_id;
    void* data;
} Value;

/* Global unit value - shared by all programs */
static Value* k_unit_value = NULL;

/* Initialize runtime */
void k_runtime_init() {
    if (!k_unit_value) {
        k_unit_value = malloc(sizeof(Value));
        k_unit_value->type_id = 0;  /* Unit type has id 0 */
        k_unit_value->data = NULL;
    }
}

/* Create unit value {} */
Value* k_make_unit() {
    k_runtime_init();
    return k_unit_value;
}

/* Create product value with multiple fields */
Value* k_make_product(int field_count, ...) {
    Value* result = malloc(sizeof(Value));
    result->type_id = 1;  /* Product type marker */
    
    if (field_count == 0) {
        result->data = NULL;
        return result;
    }
    
    /* Store array of field values */
    Value** fields = malloc(field_count * sizeof(Value*));
    
    va_list args;
    va_start(args, field_count);
    for (int i = 0; i < field_count; i++) {
        fields[i] = va_arg(args, Value*);
    }
    va_end(args);
    
    result->data = fields;
    return result;
}

/* Create union value with variant */
Value* k_make_union(int type_id, int variant_index, Value* payload) {
    Value* result = malloc(sizeof(Value));
    result->type_id = type_id;
    
    /* Simple encoding: store variant index and payload */
    int* union_data = malloc(2 * sizeof(void*));
    union_data[0] = variant_index;
    union_data[1] = (int)(long)payload;  /* Store payload pointer as int */
    
    result->data = union_data;
    return result;
}

/* Project field from product value */
Value* k_project(Value* value, int field_index) {
    if (!value || !value->data) {
        return NULL;  /* Undefined */
    }
    
    /* Simplified: assume it's a product and extract field */
    Value** fields = (Value**)value->data;
    return fields[field_index];
}

/* Get variant index from union value */
int k_get_variant(Value* value) {
    if (!value || !value->data) {
        return -1;
    }
    
    int* union_data = (int*)value->data;
    return union_data[0];
}

/* Get payload from union value */
Value* k_get_union_payload(Value* value) {
    if (!value || !value->data) {
        return NULL;
    }
    
    int* union_data = (int*)value->data;
    return (Value*)(long)union_data[1];
}

/* Check if value has specified type */
int k_has_type(Value* value, int type_id) {
    return value && value->type_id == type_id;
}

/* Memory management - simplified */
void k_retain(Value* value) {
    /* In a real implementation, this would increment reference count */
}

void k_release(Value* value) {
    /* In a real implementation, this would decrement reference count and free if needed */
    /* For now, do nothing to avoid double-free errors */
}

/* Debug helper */
void k_print_value(Value* value) {
    if (!value) {
        printf("null");
        return;
    }
    
    printf("Value(type_id=%d, data=%p)", value->type_id, value->data);
}

/* Test function */
int main() {
    printf("k-runtime library test\n");
    
    k_runtime_init();
    
    Value* unit = k_make_unit();
    printf("Unit value: ");
    k_print_value(unit);
    printf("\n");
    
    Value* fields[2] = { unit, unit };
    Value* product = k_make_product(2, fields[0], fields[1]);
    printf("Product value: ");
    k_print_value(product);
    printf("\n");
    
    Value* projected = k_project(product, 0);
    printf("Projected field: ");
    k_print_value(projected);
    printf("\n");
    
    return 0;
}