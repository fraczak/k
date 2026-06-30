#include "krt.h"

#include <string.h>

extern k_result k_main(k_rt *rt, k_value *input);

static int expect_tag(k_result result, const char *tag, k_value *payload) {
  if (result.status != K_STATUS_OK) return 1;
  if (strcmp(k_variant_tag(result.value), tag) != 0) return 2;
  if (k_variant_payload(result.value) != payload) return 3;
  return 0;
}

int main(void) {
  k_rt *rt = k_rt_new();
  if (rt == NULL) return 1;

  k_value *unit = k_unit(rt);

  k_value *x = k_variant(rt, "x", unit);
  if (expect_tag(k_main(rt, x), "left", unit) != 0) return 2;

  k_value *y = k_variant(rt, "y", unit);
  if (expect_tag(k_main(rt, y), "right", unit) != 0) return 3;

  k_value *z = k_variant(rt, "z", unit);
  if (k_main(rt, z).status == K_STATUS_OK) return 4;

  k_rt_free(rt);
  return 0;
}
