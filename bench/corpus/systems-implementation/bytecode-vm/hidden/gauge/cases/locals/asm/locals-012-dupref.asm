; case locals-012-dupref
; expect exit=0 stdout="[1]\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  DUP
  PUSH_INT 1
  ARR_PUSH
  PRINT
  RET
.end
