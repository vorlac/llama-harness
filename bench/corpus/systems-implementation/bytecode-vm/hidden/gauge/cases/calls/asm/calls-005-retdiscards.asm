; case calls-005-retdiscards
; expect exit=0 stdout="3\n"
.func main arity=0 locals=0
  CLOSURE many
  CALL 0
  PRINT
  RET
.end
.func many arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 2
  PUSH_INT 3
  RET
.end
