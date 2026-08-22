; case display-069-typeof
; expect exit=0 stdout="bool\n"
.func main arity=0 locals=0
  PUSH_FALSE
  TYPEOF
  PRINT
  RET
.end
