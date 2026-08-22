; case display-070-typeof
; expect exit=0 stdout="int\n"
.func main arity=0 locals=0
  PUSH_INT 0
  TYPEOF
  PRINT
  RET
.end
