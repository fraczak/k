#include "krt.h"

extern k_result k_main(k_rt *rt, k_value *input);

int main(void) {
  k_rt *rt = k_rt_new();
  if (rt == NULL) return 1;

  k_value *unit = k_unit(rt);
  k_value *left_value = k_variant(rt, "left", unit);
  k_value *right_value = k_variant(rt, "right", unit);

  k_value *a = k_product(rt, 1);
  k_product_set(a, "x", left_value);
  k_value *b = k_product(rt, 1);
  k_product_set(b, "x", right_value);

  k_value *input = k_product(rt, 2);
  k_product_set(input, "a", a);
  k_product_set(input, "b", b);

  k_result result = k_main(rt, input);
  if (result.status != K_STATUS_OK) return 2;
  if (k_product_get(result.value, "left") != left_value) return 3;
  if (k_product_get(result.value, "right") != right_value) return 4;

  k_rt_free(rt);
  return 0;
}
