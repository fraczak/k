#include "krt.h"

extern k_result k_main(k_rt *rt, k_value *input);

int main(void) {
  k_rt *rt = k_rt_new();
  if (rt == NULL) return 1;

  k_value *unit = k_unit(rt);
  k_value *val_a = k_variant(rt, "A", unit);
  k_value *val_b = k_variant(rt, "B", unit);
  k_value *input = k_product(rt, 2);
  k_product_set(input, "x", val_a);
  k_product_set(input, "y", val_b);

  k_result result = k_main(rt, input);
  if (result.status != K_STATUS_OK) return 2;
  if (k_product_get(result.value, "fieldA") != val_a) return 3;
  if (k_product_get(result.value, "fieldB") != val_b) return 4;

  k_rt_free(rt);
  return 0;
}
