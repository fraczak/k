#include "krt.h"

extern k_result k_main(k_rt *rt, k_value *input);

int main(void) {
  k_rt *rt = k_rt_new();
  if (rt == NULL) return 1;

  k_value *unit = k_unit(rt);
  k_value *inner = k_product(rt, 1);
  k_product_set(inner, "y", unit);

  k_value *input = k_product(rt, 1);
  k_product_set(input, "x", inner);

  k_result result = k_main(rt, input);
  if (result.status != K_STATUS_OK) return 2;
  if (result.value != unit) return 3;

  k_rt_free(rt);
  return 0;
}
