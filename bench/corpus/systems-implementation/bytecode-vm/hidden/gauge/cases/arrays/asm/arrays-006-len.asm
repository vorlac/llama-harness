; case arrays-006-len
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  LEN
  PRINT
  RET
.end
