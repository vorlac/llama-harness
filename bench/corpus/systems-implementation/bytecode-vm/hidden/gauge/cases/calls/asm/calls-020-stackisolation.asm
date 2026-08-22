; case calls-020-stackisolation
; expect exit=0 stdout="77\n"
.func main arity=0 locals=0
  PUSH_INT 77
  CLOSURE peek
  CALL 0
  POP
  PRINT
  RET
.end
.func peek arity=0 locals=0
  PUSH_NIL
  RET
.end
