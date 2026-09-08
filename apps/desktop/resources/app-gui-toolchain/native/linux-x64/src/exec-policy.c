/**
 * [INPUT]: Reads a BTEX0001 length-framed executable policy followed by the unchanged compiler stdin frame
 * [OUTPUT]: Enforces Linux Landlock EXECUTE on fixed tool inodes and their root-owned ELF interpreters before starting the compiler
 * [POS]: Freestanding Linux x86-64 compiler execution boundary inside bubblewrap namespaces
 */

typedef unsigned char u8;
typedef unsigned int u32;
typedef unsigned long u64;
typedef long i64;

#define POLICY_BYTES (2 * 1024 * 1024)
#define PATH_BYTES 32768
static u8 payload[POLICY_BYTES];
static char paths[3][PATH_BYTES + 1];

#ifdef BOTTEGA_PARSER_TEST
extern long read(int, void *, unsigned long);
extern long write(int, const void *, unsigned long);
extern long pread(int, void *, unsigned long, long);
extern int open(const char *, int, ...);
extern int close(int);
extern long lseek(int, long, int);
extern void _exit(int) __attribute__((noreturn));
static i64 input(void *buffer, u64 bytes) { return read(0, buffer, bytes); }
static i64 output(int fd, const void *buffer, u64 bytes) { return write(fd, buffer, bytes); }
static i64 positioned(i64 fd, void *buffer, u64 bytes, u64 offset) { return pread((int)fd, buffer, bytes, (i64)offset); }
static void finish(int code) { _exit(code); }
#else
#if !defined(__linux__) || !defined(__x86_64__)
#error The production launcher only supports Linux x86-64.
#endif
static i64 call(i64 number, i64 a, i64 b, i64 c, i64 d, i64 e, i64 f) {
  register i64 r10 __asm__("r10") = d;
  register i64 r8 __asm__("r8") = e;
  register i64 r9 __asm__("r9") = f;
  i64 result;
  __asm__ volatile("syscall" : "=a"(result) : "a"(number), "D"(a), "S"(b), "d"(c),
                   "r"(r10), "r"(r8), "r"(r9) : "rcx", "r11", "memory");
  return result;
}
static i64 input(void *buffer, u64 bytes) { return call(0, 0, (i64)buffer, (i64)bytes, 0, 0, 0); }
static i64 output(int fd, const void *buffer, u64 bytes) { return call(1, fd, (i64)buffer, (i64)bytes, 0, 0, 0); }
static i64 positioned(i64 fd, void *buffer, u64 bytes, u64 offset) { return call(17, fd, (i64)buffer, (i64)bytes, (i64)offset, 0, 0); }
static void finish(int code) { call(60, code, 0, 0, 0, 0, 0); __builtin_unreachable(); }
#endif

static void reject(void) {
  static const char message[] = "BOTTEGA_LINUX_EXEC_POLICY_UNAVAILABLE\n";
  output(2, message, sizeof(message) - 1);
  finish(126);
}

static void exact(void *target, u64 length) {
  u8 *bytes = target;
  while (length) {
    i64 count = input(bytes, length);
#ifndef BOTTEGA_PARSER_TEST
    if (count == -4) continue;
#endif
    if (count <= 0 || (u64)count > length) reject();
    bytes += count;
    length -= (u64)count;
  }
}

static u32 integer(const u8 *bytes) {
  return ((u32)bytes[0] << 24) | ((u32)bytes[1] << 16) | ((u32)bytes[2] << 8) | bytes[3];
}

static int equal(const char *left, const char *right) {
  while (*left && *left == *right) { left++; right++; }
  return *left == *right;
}

static u32 policy(void) {
  u8 header[4];
  exact(header, sizeof(header));
  u32 length = integer(header);
  if (length < 12 || length > POLICY_BYTES) reject();
  exact(payload, length);
  const char magic[] = "BTEX0001";
  for (u32 index = 0; index < 8; index++) if (payload[index] != (u8)magic[index]) reject();
  u32 count = integer(payload + 8);
  if (count < 1 || count > 2) reject();
  u32 cursor = 12;
  for (u32 index = 0; index <= count; index++) {
    if (length - cursor < 4) reject();
    u32 bytes = integer(payload + cursor);
    cursor += 4;
    if (!bytes || bytes > PATH_BYTES || bytes > length - cursor || payload[cursor] != '/') reject();
    for (u32 offset = 0; offset < bytes; offset++) {
      if (!payload[cursor + offset]) reject();
      paths[index][offset] = (char)payload[cursor + offset];
    }
    paths[index][bytes] = 0;
    cursor += bytes;
  }
  if (cursor != length || (count == 2 && equal(paths[0], paths[2]))) reject();
  return count;
}

static u64 little(const u8 *bytes, u32 length) {
  u64 value = 0;
  for (u32 index = 0; index < length; index++) value |= (u64)bytes[index] << (index * 8);
  return value;
}

static void read_at(i64 fd, void *target, u64 length, u64 offset, u64 size) {
  if (offset > size || length > size - offset) reject();
  u8 *bytes = target;
  while (length) {
    i64 count = positioned(fd, bytes, length, offset);
#ifndef BOTTEGA_PARSER_TEST
    if (count == -4) continue;
#endif
    if (count <= 0 || (u64)count > length) reject();
    bytes += count;
    offset += (u64)count;
    length -= (u64)count;
  }
}

/* Read only bounded ELF headers, even when the Electron image is hundreds of MB. */
static int elf_interpreter(i64 fd, u64 size, char *path) {
  u8 header[64], program[56];
  read_at(fd, header, sizeof(header), 0, size);
  if (header[0] != 0x7f || header[1] != 'E' || header[2] != 'L' || header[3] != 'F' ||
      header[4] != 2 || header[5] != 1 || header[6] != 1 ||
      (little(header + 16, 2) != 2 && little(header + 16, 2) != 3) ||
      little(header + 18, 2) != 62 || little(header + 20, 4) != 1 ||
      little(header + 52, 2) != sizeof(header) || little(header + 54, 2) != sizeof(program)) reject();
  u64 offset = little(header + 32, 8), count = little(header + 56, 2);
  if (!count || count > 128 || offset < sizeof(header) || offset > size || count * sizeof(program) > size - offset) reject();
  int found = 0;
  for (u64 index = 0; index < count; index++) {
    read_at(fd, program, sizeof(program), offset + index * sizeof(program), size);
    if (little(program, 4) != 3) continue; /* PT_INTERP */
    u64 start = little(program + 8, 8), length = little(program + 32, 8);
    if (found || length < 2 || length > 4096) reject();
    read_at(fd, path, length, start, size);
    if (path[0] != '/' || path[length - 1] != 0) reject();
    for (u64 cursor = 0; cursor < length - 1; cursor++) if (!path[cursor]) reject();
    found = 1;
  }
  return found;
}

#ifndef BOTTEGA_PARSER_TEST
/* Linux v6.8 x86-64 UAPI layouts and syscall numbers, without a libc dependency. */
struct inode_stat {
  u64 dev, ino, nlink;
  u32 mode, uid, gid, padding;
  u64 rdev;
  i64 size, blksize, blocks, atime, atime_ns, mtime, mtime_ns, ctime, ctime_ns, reserved[3];
};
struct path_rule { u64 allowed_access; int parent_fd; } __attribute__((packed));
_Static_assert(sizeof(struct inode_stat) == 144, "Unexpected Linux stat ABI");
_Static_assert(sizeof(struct path_rule) == 12, "Unexpected Landlock path ABI");

static u64 allow_fd(i64 ruleset, i64 fd, int interpreter) {
  struct inode_stat info;
  if (fd < 0 || call(5, fd, (i64)&info, 0, 0, 0, 0) || (info.mode & 0170000) != 0100000 ||
      (info.mode & 06000) || !(info.mode & 0111) || info.size <= 0 ||
      (interpreter && (info.uid != 0 || (info.mode & 022)))) reject();
  struct path_rule rule = { 1, (int)fd };
  if (call(445, ruleset, 1, (i64)&rule, 0, 0, 0)) reject();
  return (u64)info.size;
}

static void allow(i64 ruleset, const char *path) {
  /* Open the admitted tool without following links; directories never grant subtree execution. */
  i64 fd = call(2, (i64)path, 02000000 | 0400000, 0, 0, 0, 0); /* O_RDONLY | O_CLOEXEC | O_NOFOLLOW */
  u64 size = allow_fd(ruleset, fd, 0);
  char interpreter[4096];
  if (elf_interpreter(fd, size, interpreter)) {
    /* binfmt_elf opens PT_INTERP with MAY_EXEC too. Follow the OS loader symlink,
       but authorize only its opened root-owned, non-writable regular-file inode. */
    i64 loader = call(2, (i64)interpreter, 02000000, 0, 0, 0, 0);
    u64 loader_size = allow_fd(ruleset, loader, 1);
    if (elf_interpreter(loader, loader_size, interpreter)) reject();
    call(3, loader, 0, 0, 0, 0, 0);
  }
  call(3, fd, 0, 0, 0, 0, 0);
}

__attribute__((used, noreturn)) static void enter(u64 *stack) {
  u64 argc = stack[0];
  char **argv = (char **)(stack + 1);
  if (argc != 2 || !equal(argv[1], "--stdio-v1")) reject();
  char **environment = argv + argc + 1;
  u32 count = policy();
  if (call(444, 0, 0, 1, 0, 0, 0) < 1) reject();
  u64 access = 1; /* LANDLOCK_ACCESS_FS_EXECUTE only; namespaces own read/write/network. */
  i64 ruleset = call(444, (i64)&access, sizeof(access), 0, 0, 0, 0);
  if (ruleset < 0) reject();
  allow(ruleset, paths[0]);
  if (count == 2) allow(ruleset, paths[2]);
  if (call(157, 38, 1, 0, 0, 0, 0) || call(446, ruleset, 0, 0, 0, 0, 0)) reject();
  call(3, ruleset, 0, 0, 0, 0, 0);
  char *command[] = { paths[0], paths[1], (char *)0 };
  call(59, (i64)command[0], (i64)command, (i64)environment, 0, 0, 0);
  reject();
  __builtin_unreachable();
}

__asm__(".global _start\n_start:\nmov %rsp,%rdi\nand $-16,%rsp\ncall enter\nud2\n");
#else
int main(int argc, char **argv) {
  if (argc == 3 && equal(argv[1], "--elf-interpreter")) {
    int fd = open(argv[2], 0);
    i64 size = fd < 0 ? -1 : lseek(fd, 0, 2);
    if (size <= 0) reject();
    char interpreter[4096];
    if (elf_interpreter(fd, (u64)size, interpreter)) {
      u64 length = 0;
      while (interpreter[length]) length++;
      output(1, interpreter, length);
    }
    close(fd);
    return 0;
  }
  if (argc != 2 || !equal(argv[1], "--stdio-v1")) reject();
  (void)policy();
  /* Echo only the untouched compiler stream; this branch executes no Linux syscall. */
  for (;;) {
    i64 count = input(payload, sizeof(payload));
    if (!count) break;
    if (count < 0 || output(1, payload, (u64)count) != count) reject();
  }
  return 0;
}
#endif
