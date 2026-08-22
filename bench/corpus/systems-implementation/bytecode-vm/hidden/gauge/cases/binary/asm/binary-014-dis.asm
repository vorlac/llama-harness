; case binary-014-dis
; expect exit=0 stdout="; svm disassembly\n.func main arity=0 locals=0 upvals=0\n  PUSH_INT 1\n  STORE_GLOBAL \"odd name\"\n  LOAD_GLOBAL \"odd name\"\n  PRINT\n  RET\n.end\n"
.func main arity=0 locals=0
  PUSH_INT 1
  STORE_GLOBAL "odd name"
  LOAD_GLOBAL "odd name"
  PRINT
  RET
.end
