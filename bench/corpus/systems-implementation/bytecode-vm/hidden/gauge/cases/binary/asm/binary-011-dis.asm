; case binary-011-dis
; expect exit=0 stdout="; svm disassembly\n.func main arity=0 locals=0 upvals=0\n  PUSH_STR \"hello, svm\"\n  PRINT\n  PUSH_INT 6\n  PUSH_INT 7\n  MUL\n  PRINT\n  RET\n.end\n"
.func main arity=0 locals=0
  PUSH_STR "hello, svm"
  PRINT
  PUSH_INT 6
  PUSH_INT 7
  MUL
  PRINT
  RET
.end
