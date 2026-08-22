; case binary-013-dis
; expect exit=0 stdout="; svm disassembly\n.func main arity=0 locals=0 upvals=0\n  CLOSURE outer\n  PUSH_INT 7\n  CALL 1\n  CALL 0\n  PRINT\n  RET\n.end\n.func outer arity=1 locals=1 upvals=0\n  CLOSURE inner\n  RET\n.end\n.func inner arity=0 locals=0 upvals=1\n  .upval local 0\n  LOAD_UPVAL 0\n  RET\n.end\n"
.func main arity=0 locals=0
  CLOSURE outer
  PUSH_INT 7
  CALL 1
  CALL 0
  PRINT
  RET
.end
.func outer arity=1 locals=1
  CLOSURE inner
  RET
.end
.func inner arity=0 locals=0 upvals=1
  .upval local 0
  LOAD_UPVAL 0
  RET
.end
