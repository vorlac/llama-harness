; case display-048-array
; expect exit=0 stdout="[\"back\\\\slash\"]\n"
.func main arity=0 locals=0
  PUSH_STR "back\\slash"
  NEW_ARRAY 1
  PRINT
  RET
.end
