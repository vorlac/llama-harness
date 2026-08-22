; case display-060-array
; expect exit=0 stdout="[nil, true]\n"
.func main arity=0 locals=0
  PUSH_NIL
  PUSH_TRUE
  NEW_ARRAY 2
  PRINT
  RET
.end
