; case display-002-tostr
; expect exit=0 stdout="nil\n"
.func main arity=0 locals=0
  PUSH_NIL
  TOSTR
  PRINT
  RET
.end
