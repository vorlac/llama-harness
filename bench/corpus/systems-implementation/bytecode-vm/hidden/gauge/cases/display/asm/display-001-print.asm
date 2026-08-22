; case display-001-print
; expect exit=0 stdout="nil\n"
.func main arity=0 locals=0
  PUSH_NIL
  PRINT
  RET
.end
