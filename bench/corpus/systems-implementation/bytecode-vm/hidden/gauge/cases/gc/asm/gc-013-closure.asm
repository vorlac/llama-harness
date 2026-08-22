; case gc-013-closure
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  CLOSURE helper
  GCLIVE
  PRINT
  RET
.end
.func helper arity=0 locals=0
  PUSH_NIL
  RET
.end
