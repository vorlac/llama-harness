; case display-044-array
; expect exit=0 stdout="[\"a\\nb\"]\n"
.func main arity=0 locals=0
  PUSH_STR "a\nb"
  NEW_ARRAY 1
  PRINT
  RET
.end
