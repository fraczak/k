#include "krt.h"

#include <string.h>

extern k_result k_main(k_rt *rt, k_value *input);

int main(void) {
  k_rt *rt = k_rt_new();
  if (rt == NULL) return 1;

  k_value *unit = k_unit(rt);
  k_result result = k_main(rt, unit);
  if (result.status != K_STATUS_OK) return 2;
  if (result.value != unit) return 3;

  k_value *product = k_product(rt, 1);
  k_product_set(product, "x", unit);
  if (k_product_get(product, "x") != unit) return 4;

  k_value *variant = k_variant(rt, "tag", product);
  if (strcmp(k_variant_tag(variant), "tag") != 0) return 5;
  if (k_variant_payload(variant) != product) return 6;
  if (!k_equal(unit, unit)) return 7;

  k_rt_free(rt);
  return 0;
}
