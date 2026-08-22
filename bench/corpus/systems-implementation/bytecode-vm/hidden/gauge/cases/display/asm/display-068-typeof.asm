; case display-068-typeof
; expect exit=0 stdout="bool\n"
.func main arity=0 locals=0
  PUSH_TRUE
  TYPEOF
  PRINT
  RET
.end
