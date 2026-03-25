#define _GNU_SOURCE
#include <dlfcn.h>
#include <time.h>

static __thread struct timespec last_mono = {0, 0};

int clock_gettime(clockid_t clk_id, struct timespec *tp) {
    static int (*real_clock_gettime)(clockid_t, struct timespec *) = NULL;
    if (!real_clock_gettime)
        real_clock_gettime = dlsym(RTLD_NEXT, "clock_gettime");

    int ret = real_clock_gettime(clk_id, tp);
    if (ret != 0) return ret;

    if (clk_id == CLOCK_MONOTONIC || clk_id == CLOCK_MONOTONIC_RAW ||
        clk_id == CLOCK_MONOTONIC_COARSE) {
        if (tp->tv_sec < last_mono.tv_sec ||
            (tp->tv_sec == last_mono.tv_sec && tp->tv_nsec < last_mono.tv_nsec)) {
            *tp = last_mono;
        } else {
            last_mono = *tp;
        }
    }
    return ret;
}
