; case control-023-not
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_NIL
  NOT
  PRINT
  RET
.end
