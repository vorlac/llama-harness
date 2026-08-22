; case arrays-007-len
; expect exit=0 stdout="2\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_INT 2
  NEW_ARRAY 2
  LEN
  PRINT
  RET
.end
