; case binary-015-dis
; expect exit=0 stdout="; svm disassembly\n.func main arity=0 locals=0 upvals=0\n  PUSH_STR \"a\\nb\\t\\\"c\\\"\\\\d\"\n  PRINT\n  PUSH_INT 0\n  CHR\n  PRINT\n  RET\n.end\n"
.func main arity=0 locals=0
  PUSH_STR "a\nb\t\"c\"\\d"
  PRINT
  PUSH_INT 0
  CHR
  PRINT
  RET
.end
