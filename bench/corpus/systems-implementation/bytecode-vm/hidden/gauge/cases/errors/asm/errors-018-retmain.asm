; case errors-018-retmain
; expect exit=0 stdout=""
.func main arity=0 locals=0
  PUSH_INT 99
  RET
.end
