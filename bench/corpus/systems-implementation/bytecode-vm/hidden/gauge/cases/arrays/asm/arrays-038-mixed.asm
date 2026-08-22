; case arrays-038-mixed
; expect exit=0 stdout="[1, \"a\", nil, true, false]\n"
.func main arity=0 locals=0
  PUSH_INT 1
  PUSH_STR "a"
  PUSH_NIL
  PUSH_TRUE
  PUSH_FALSE
  NEW_ARRAY 5
  PRINT
  RET
.end
