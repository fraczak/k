#include "krt.h"

extern k_result k_main(k_rt *rt, k_value *input);

int main(void) {
  k_rt *rt = k_rt_new();
  if (rt == NULL) return 1;

  k_value *unit = k_unit(rt);
  k_value *matching = k_variant(rt, "tag", unit);
  k_result result = k_main(rt, matching);
  if (result.status != K_STATUS_OK) return 2;
  if (result.value != unit) return 3;

  k_value *other = k_variant(rt, "other", unit);
  k_result mismatch = k_main(rt, other);
  if (mismatch.status == K_STATUS_OK) return 4;

  k_rt_free(rt);
  return 0;
}
