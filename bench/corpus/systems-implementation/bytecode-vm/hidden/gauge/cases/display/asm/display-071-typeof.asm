; case display-071-typeof
; expect exit=0 stdout="str\n"
.func main arity=0 locals=0
  PUSH_STR "s"
  TYPEOF
  PRINT
  RET
.end
