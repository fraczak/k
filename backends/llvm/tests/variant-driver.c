#include "krt.h"

#include <string.h>

extern k_result k_main(k_rt *rt, k_value *input);

int main(void) {
  k_rt *rt = k_rt_new();
  if (rt == NULL) return 1;

  k_value *unit = k_unit(rt);
  k_result result = k_main(rt, unit);
  if (result.status != K_STATUS_OK) return 2;
  if (strcmp(k_variant_tag(result.value), "tag") != 0) return 3;
  if (k_variant_payload(result.value) != unit) return 4;

  k_rt_free(rt);
  return 0;
}
