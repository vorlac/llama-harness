; case binary-016-dis
; expect exit=0 stdout="; svm disassembly\n.func main arity=0 locals=0 upvals=0\n  PUSH_INT -9223372036854775808\n  PRINT\n  PUSH_INT 9223372036854775807\n  PRINT\n  RET\n.end\n"
.func main arity=0 locals=0
  PUSH_INT -9223372036854775808
  PRINT
  PUSH_INT 9223372036854775807
  PRINT
  RET
.end
