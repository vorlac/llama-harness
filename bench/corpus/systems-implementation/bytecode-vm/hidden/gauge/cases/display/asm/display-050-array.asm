; case display-050-array
; expect exit=0 stdout="[\"\\t\"]\n"
.func main arity=0 locals=0
  PUSH_STR "\t"
  NEW_ARRAY 1
  PRINT
  RET
.end
