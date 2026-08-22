; case display-073-typeof
; expect exit=0 stdout="fn\n"
.func main arity=0 locals=0
  CLOSURE helper
  TYPEOF
  PRINT
  RET
.end
.func helper arity=0 locals=0
  PUSH_NIL
  RET
.end
