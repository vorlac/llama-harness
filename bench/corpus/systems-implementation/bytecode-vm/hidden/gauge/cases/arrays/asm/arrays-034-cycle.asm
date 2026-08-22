; case arrays-034-cycle
; expect exit=0 stdout="[[...]]\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  DUP
  DUP
  ARR_PUSH
  PRINT
  RET
.end
