; case calls-004-emptyret
; expect exit=0 stdout="nil\n"
.func main arity=0 locals=0
  CLOSURE nothing
  CALL 0
  PRINT
  RET
.end
.func nothing arity=0 locals=0
  RET
.end
