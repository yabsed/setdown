// Smoke test: can the LibreOffice installed on this machine be driven through
// LibreOfficeKit (no window), and what do load / first tile / save cost?
// usage: lok_smoke <install program dir> <profile url> <out dir> <file>...
#define LOK_USE_UNSTABLE_API
#include <LibreOfficeKit/LibreOfficeKitInit.h>
#include <LibreOfficeKit/LibreOfficeKit.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static double now(void) {
  struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1000.0 + t.tv_nsec / 1e6;
}
static long rss_mib(void) {
  FILE *f = fopen("/proc/self/status", "r"); char line[256]; long kb = 0;
  while (f && fgets(line, sizeof line, f)) if (sscanf(line, "VmRSS: %ld kB", &kb) == 1) break;
  if (f) fclose(f);
  return kb / 1024;
}
static const char *type_name(int type) {
  static const char *names[] = { "text", "spreadsheet", "presentation", "drawing", "other" };
  return type >= 0 && type <= 4 ? names[type] : "?";
}

int main(int argc, char **argv) {
  if (argc < 5) { fprintf(stderr, "usage\n"); return 2; }
  setvbuf(stdout, NULL, _IOLBF, 0);
  double t0 = now();
  LibreOfficeKit *office = lok_init_2(argv[1], argv[2]);
  if (!office) { fprintf(stderr, "lok_init failed\n"); return 1; }
  char *version = office->pClass->getVersionInfo(office);
  printf("init_ms=%.0f rss_mib=%ld version=%s\n", now() - t0, rss_mib(), version ? version : "?");
  free(version);

  for (int i = 4; i < argc; i++) {
    char url[4096]; snprintf(url, sizeof url, "file://%s", argv[i]);
    const char *base = strrchr(argv[i], '/'); base = base ? base + 1 : argv[i];
    double t1 = now();
    LibreOfficeKitDocument *doc = office->pClass->documentLoad(office, url);
    if (!doc) {
      char *error = office->pClass->getError(office);
      printf("%s load FAILED: %s\n", base, error ? error : "?");
      continue;
    }
    double loaded = now() - t1;
    doc->pClass->initializeForRendering(doc, NULL);
    long width = 0, height = 0;
    doc->pClass->getDocumentSize(doc, &width, &height);
    int type = doc->pClass->getDocumentType(doc);
    int parts = doc->pClass->getParts(doc);

    // One 1024 px wide tile of the top of the document. A twip is 1/1440 inch.
    const int px = 1024;
    long tile_width = width < 16000 ? width : 16000;
    long tile_height = tile_width;
    unsigned char *pixels = calloc((size_t)px * px, 4);
    double t2 = now();
    doc->pClass->paintTile(doc, pixels, px, px, 0, 0, (int)tile_width, (int)tile_height);
    double painted = now() - t2;
    // LOK paints BGRA premultiplied; store RGBA for the PNG conversion.
    for (size_t p = 0; p < (size_t)px * px; p++) { unsigned char b = pixels[p * 4]; pixels[p * 4] = pixels[p * 4 + 2]; pixels[p * 4 + 2] = b; }
    char out[4096]; snprintf(out, sizeof out, "%s/%s.rgba", argv[3], base);
    FILE *f = fopen(out, "wb"); if (f) { fwrite(pixels, 4, (size_t)px * px, f); fclose(f); }
    free(pixels);

    // Round trips: the same format back, and a PDF.
    const char *ext = strrchr(base, '.'); ext = ext ? ext + 1 : "";
    const char *same = !strcmp(ext, "doc") ? "docx" : !strcmp(ext, "xls") ? "xlsx" : !strcmp(ext, "ppt") ? "pptx" : ext;
    snprintf(out, sizeof out, "file://%s/%s.saved.%s", argv[3], base, same);
    double t3 = now();
    int saved = doc->pClass->saveAs(doc, out, same, NULL);
    double save_ms = now() - t3;
    snprintf(out, sizeof out, "file://%s/%s.pdf", argv[3], base);
    double t4 = now();
    int pdf = doc->pClass->saveAs(doc, out, "pdf", NULL);
    double pdf_ms = now() - t4;

    printf("%s type=%s parts=%d size_twips=%ldx%ld load_ms=%.0f tile_ms=%.0f save_%s=%s(%.0fms) pdf=%s(%.0fms) rss_mib=%ld\n",
      base, type_name(type), parts, width, height, loaded, painted, same, saved ? "ok" : "FAILED", save_ms,
      pdf ? "ok" : "FAILED", pdf_ms, rss_mib());
    doc->pClass->destroy(doc);
  }
  // Static destructors of the office libraries crash after destroy() on this build
  // (seen 2026-11-21: SIGSEGV in LOKClipboard from an exit handler), so leave without them.
  fflush(stdout);
  if (getenv("LOK_SMOKE_DESTROY")) { office->pClass->destroy(office); return 0; }
  _exit(0);
}
