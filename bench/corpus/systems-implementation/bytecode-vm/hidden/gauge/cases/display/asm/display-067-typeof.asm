; case display-067-typeof
; expect exit=0 stdout="nil\n"
.func main arity=0 locals=0
  PUSH_NIL
  TYPEOF
  PRINT
  RET
.end
